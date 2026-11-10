package handlers

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	db        *db.DB
	jwtSecret string
	// photoDir is here only so deleting an account can delete the meal photos
	// too: they live on disk, outside every cascade the database performs.
	photoDir string
	svc      AuthServices
}

// userColumns e scanUser mantêm num lugar só a forma como um User é lido.
// has_password sai do hash sem trazê-lo.
const userColumns = `id, email, name, avatar_url, google_id, apple_id, (password_hash IS NOT NULL), created_at`

func scanUser(row pgx.Row, user *models.User, extra ...any) error {
	dest := []any{&user.ID, &user.Email, &user.Name, &user.AvatarURL, &user.GoogleID, &user.AppleID, &user.HasPassword, &user.CreatedAt}
	return row.Scan(append(dest, extra...)...)
}

func NewAuthHandler(database *db.DB, jwtSecret, photoDir string, svc AuthServices) *AuthHandler {
	return &AuthHandler{db: database, jwtSecret: jwtSecret, photoDir: photoDir, svc: svc}
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Name == "" || len(req.Name) > 100 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name must be between 1 and 100 characters"})
		return
	}
	if !validEmail(req.Email) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid email"})
		return
	}
	if len(req.Password) < 8 || len(req.Password) > 72 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must be between 8 and 72 characters"})
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to secure password"})
		return
	}

	var user models.User
	err = scanUser(h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO users (email, name, password_hash)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (email) DO NOTHING
		 RETURNING `+userColumns,
		req.Email, req.Name, string(passwordHash),
	), &user)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "email already registered"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create user"})
		return
	}

	h.writeAuthResponse(w, http.StatusCreated, &user)
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	var user models.User
	var passwordHash *string
	err := scanUser(h.db.Pool.QueryRow(r.Context(),
		`SELECT `+userColumns+`, password_hash
		 FROM users WHERE email = $1`, req.Email,
	), &user, &passwordHash)
	if err != nil || passwordHash == nil || bcrypt.CompareHashAndPassword([]byte(*passwordHash), []byte(req.Password)) != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
		return
	}

	h.writeAuthResponse(w, http.StatusOK, &user)
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var user models.User
	err := scanUser(h.db.Pool.QueryRow(r.Context(),
		`SELECT `+userColumns+` FROM users WHERE id = $1`,
		userID,
	), &user)

	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}

	writeJSON(w, http.StatusOK, user)
}

// DeleteAccount erases the account and everything hanging off it. Apple requires
// this path to exist inside the app (guideline 5.1.1(v)) for any app that lets
// someone create an account, and the LGPD requires the deletion to be real.
//
// The row is what carries the data away: every table that references
// `users(id)` does so with ON DELETE CASCADE, so a single DELETE takes profile,
// plans, workouts, sets, food logs and chats with it. The photos are the
// exception — they are files, and no cascade reaches them.
func (h *AuthHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req models.DeleteAccountRequest
	// An empty body is fine for a Google or Apple account, which has no password.
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	var passwordHash, appleRefreshToken *string
	var appleID *string
	if err := h.db.Pool.QueryRow(r.Context(),
		`SELECT password_hash, apple_id, apple_refresh_token FROM users WHERE id = $1`, userID,
	).Scan(&passwordHash, &appleID, &appleRefreshToken); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}
	// A stolen phone with an open session is the threat here, so the password is
	// asked for again. An account created through Google has none to ask for;
	// there the confirmation in the app is what stands.
	if passwordHash != nil {
		if bcrypt.CompareHashAndPassword([]byte(*passwordHash), []byte(req.Password)) != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "senha incorreta"})
			return
		}
	}

	// A Apple exige revogar o vínculo ao excluir a conta. Antes do DELETE porque
	// o refresh_token mora na linha; e sem derrubar a exclusão se falhar — a
	// pessoa pediu para sair, e o LGPD vale mais que a limpeza do lado da Apple.
	if appleID != nil {
		h.revokeApple(r.Context(), userID, appleRefreshToken)
	}

	if _, err := h.db.Pool.Exec(r.Context(), `DELETE FROM users WHERE id = $1`, userID); err != nil {
		slog.Error("failed to delete account", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete account"})
		return
	}

	// After the row, never before: a failed DELETE would otherwise leave a live
	// account whose photos are gone. Orphan files are recoverable by a sweep;
	// deleted photos under a surviving account are not.
	if h.photoDir != "" {
		dir := filepath.Join(h.photoDir, strconv.FormatInt(userID, 10))
		if err := os.RemoveAll(dir); err != nil {
			slog.Error("account deleted but its photos remain on disk", "user_id", userID, "dir", dir, "error", err)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) writeAuthResponse(w http.ResponseWriter, status int, user *models.User) {
	token, err := middleware.GenerateToken(user.ID, user.Email, h.jwtSecret)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}
	writeJSON(w, status, models.AuthResponse{Token: token, User: *user})
}

func validEmail(email string) bool {
	address, err := mail.ParseAddress(email)
	return err == nil && address.Address == email
}
