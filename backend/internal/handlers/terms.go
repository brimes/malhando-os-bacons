package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

// CurrentTermsVersion is bumped whenever the disclaimer text changes. Everyone
// who accepted an older version is asked again, so a change to the terms is a
// one-line change here plus the new text on the app.
const CurrentTermsVersion = "2026-07-1"

type TermsHandler struct {
	db *db.DB
}

func NewTermsHandler(database *db.DB) *TermsHandler {
	return &TermsHandler{db: database}
}

func (h *TermsHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	status, err := h.loadStatus(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load terms status"})
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (h *TermsHandler) Accept(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.AcceptTermsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	// Accepting a version the server does not serve would record consent to a
	// text nobody can produce anymore.
	if strings.TrimSpace(req.Version) != CurrentTermsVersion {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "a versão do termo está desatualizada; recarregue o aplicativo e leia o termo novamente",
		})
		return
	}

	result, err := h.db.Pool.Exec(r.Context(),
		`UPDATE users SET terms_accepted_at = NOW(), terms_version = $2 WHERE id = $1`,
		userID, CurrentTermsVersion)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save terms acceptance"})
		return
	}
	if result.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}

	status, err := h.loadStatus(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load terms status"})
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (h *TermsHandler) loadStatus(ctx context.Context, userID int64) (models.TermsStatus, error) {
	status := models.TermsStatus{CurrentVersion: CurrentTermsVersion}
	var acceptedAt *time.Time
	var acceptedVersion *string
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT terms_accepted_at, terms_version FROM users WHERE id = $1`, userID,
	).Scan(&acceptedAt, &acceptedVersion); err != nil {
		return status, err
	}
	status.AcceptedAt = acceptedAt
	status.AcceptedVersion = acceptedVersion
	status.Accepted = acceptedAt != nil && acceptedVersion != nil && *acceptedVersion == CurrentTermsVersion
	return status, nil
}
