package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

const (
	// maxPhotoBytes caps what the server accepts. The app compresses to under
	// this before sending (canvas, longest side 1280px, JPEG q0.7), so this is
	// a backstop, not the normal path.
	maxPhotoBytes        = 500 * 1024
	photoAnalysisTimeout = 45 * time.Second
)

var allowedPhotoExtensions = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

// UploadPhoto accepts a plate or label photo as multipart/form-data (never
// base64-in-JSON: that would inflate the payload by a third and run through
// the same axios interceptor that queues offline mutations, which cannot
// carry a photo). It validates, writes the file under PhotoDir, asks vision
// for an analysis, and returns both the analysis and the photo id so the
// client can later attach it to whatever the person decides to log.
func (h *NutritionHandler) UploadPhoto(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	kind := r.URL.Query().Get("kind")
	if kind != "plate" && kind != "label" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "kind deve ser 'plate' ou 'label'"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxPhotoBytes+64*1024)
	if err := r.ParseMultipartForm(maxPhotoBytes + 64*1024); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "foto muito grande ou requisição inválida (máximo 500KB)"})
		return
	}
	file, _, err := r.FormFile("photo")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "campo 'photo' é obrigatório"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxPhotoBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "falha ao ler a foto"})
		return
	}
	if len(data) > maxPhotoBytes {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a foto deve ter no máximo 500KB"})
		return
	}
	// The declared content-type is never trusted: the first bytes decide.
	contentType := http.DetectContentType(data)
	ext, ok := allowedPhotoExtensions[contentType]
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "formato de imagem não suportado; envie JPEG, PNG ou WEBP"})
		return
	}

	vision, err := h.resolver.VisionFor(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "o assistente configurado não analisa fotos"})
		return
	}
	visionCtx, cancel := context.WithTimeout(r.Context(), photoAnalysisTimeout)
	defer cancel()
	image := []services.ImagePart{{MIMEType: contentType, Data: data}}
	assistant := services.NewFoodVisionAssistant(vision)

	var analysisPayload any
	if kind == "plate" {
		analysis, err := assistant.AnalyzePlate(visionCtx, image)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "não foi possível analisar o prato; tente novamente"})
			return
		}
		analysisPayload = analysis
	} else {
		analysis, err := assistant.AnalyzeLabel(visionCtx, image)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "não foi possível ler o rótulo; tente novamente"})
			return
		}
		analysisPayload = analysis
	}

	relPath, err := writePhotoFile(h.photoDir, userID, ext, data)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save photo"})
		return
	}

	var photo models.MealPhoto
	if err := h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO meal_photos (user_id, kind, storage_path, content_type, byte_size)
		 VALUES ($1,$2,$3,$4,$5) RETURNING id, user_id, food_log_id, food_item_id, kind, content_type, byte_size, created_at`,
		userID, kind, relPath, contentType, len(data),
	).Scan(&photo.ID, &photo.UserID, &photo.FoodLogID, &photo.FoodItemID, &photo.Kind, &photo.ContentType, &photo.ByteSize, &photo.CreatedAt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save photo metadata"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"photo_id": photo.ID,
		"kind":     kind,
		"analysis": analysisPayload,
	})
}

// ServePhoto streams a stored photo back to its owner only. The path on disk
// is always derived from the id and the authenticated user, never taken from
// the client, so there is no path-traversal surface here.
func (h *NutritionHandler) ServePhoto(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid photo id"})
		return
	}
	var storagePath, contentType string
	var createdAt time.Time
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT storage_path, content_type, created_at FROM meal_photos WHERE id=$1 AND user_id=$2`,
		id, userID).Scan(&storagePath, &contentType, &createdAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "photo not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load photo"})
		return
	}

	file, err := os.Open(filepath.Join(h.photoDir, storagePath))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "photo file not found"})
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", createdAt, file)
}

// writePhotoFile writes under PhotoDir/<user_id>/<random>.<ext> and returns
// the path relative to PhotoDir, which is what gets stored in the database —
// the absolute PhotoDir may differ between environments (bind mount in dev,
// PVC in production).
func writePhotoFile(photoDir string, userID int64, ext string, data []byte) (string, error) {
	dir := filepath.Join(photoDir, strconv.FormatInt(userID, 10))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create photo dir: %w", err)
	}
	name, err := randomFilename()
	if err != nil {
		return "", err
	}
	relPath := filepath.Join(strconv.FormatInt(userID, 10), name+ext)
	if err := os.WriteFile(filepath.Join(photoDir, relPath), data, 0o644); err != nil {
		return "", fmt.Errorf("write photo file: %w", err)
	}
	return relPath, nil
}

func randomFilename() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
