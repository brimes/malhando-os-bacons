package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

type AuthHandler struct {
	db        *db.DB
	jwtSecret string
}

func NewAuthHandler(database *db.DB, jwtSecret string) *AuthHandler {
	return &AuthHandler{db: database, jwtSecret: jwtSecret}
}

type googleTokenInfo struct {
	Sub     string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

func (h *AuthHandler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	var req models.GoogleAuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.IDToken == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id_token is required"})
		return
	}

	// Verify token with Google
	info, err := verifyGoogleToken(r.Context(), req.IDToken)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid google token"})
		return
	}

	// Upsert user
	user, err := h.upsertUser(r.Context(), info)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save user"})
		return
	}

	// Generate JWT
	token, err := middleware.GenerateToken(user.ID, user.Email, h.jwtSecret)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	writeJSON(w, http.StatusOK, models.AuthResponse{
		Token: token,
		User:  *user,
	})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var user models.User
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT id, email, name, avatar_url, google_id, created_at FROM users WHERE id = $1`,
		userID,
	).Scan(&user.ID, &user.Email, &user.Name, &user.AvatarURL, &user.GoogleID, &user.CreatedAt)

	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return
	}

	writeJSON(w, http.StatusOK, user)
}

func (h *AuthHandler) upsertUser(ctx context.Context, info *googleTokenInfo) (*models.User, error) {
	var user models.User
	err := h.db.Pool.QueryRow(ctx,
		`INSERT INTO users (email, name, avatar_url, google_id)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (google_id) DO UPDATE
		 SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
		 RETURNING id, email, name, avatar_url, google_id, created_at`,
		info.Email, info.Name, info.Picture, info.Sub,
	).Scan(&user.ID, &user.Email, &user.Name, &user.AvatarURL, &user.GoogleID, &user.CreatedAt)

	if err != nil {
		return nil, fmt.Errorf("upsert user: %w", err)
	}
	return &user, nil
}

func verifyGoogleToken(ctx context.Context, idToken string) (*googleTokenInfo, error) {
	url := "https://oauth2.googleapis.com/tokeninfo?id_token=" + idToken
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google token verification failed with status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var info googleTokenInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, err
	}

	if info.Sub == "" {
		return nil, fmt.Errorf("invalid token: missing sub claim")
	}

	return &info, nil
}
