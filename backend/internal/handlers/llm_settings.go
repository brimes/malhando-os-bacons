package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

// maxModelNameLength keeps a typo from being stored as a model name and then
// failing on every generation.
const maxModelNameLength = 100

type LLMSettingsHandler struct {
	db *db.DB
}

func NewLLMSettingsHandler(database *db.DB) *LLMSettingsHandler {
	return &LLMSettingsHandler{db: database}
}

func (h *LLMSettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	settings, err := h.loadSettings(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load llm settings"})
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// Update saves the provider, the model and — when one is sent — the user's own
// API key. An empty api_key clears the stored key, moving the user back to the
// shared credits.
func (h *LLMSettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.SaveLLMSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if provider == "" {
		provider = "gemini"
	}
	if provider != "gemini" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "provider inválido; no momento apenas o gemini é suportado",
		})
		return
	}
	model := strings.TrimSpace(req.Model)
	if len(model) > maxModelNameLength {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "o nome do modelo é longo demais"})
		return
	}
	apiKey := strings.TrimSpace(req.APIKey)

	if apiKey != "" {
		// Validated before it is stored: a key that does not work would
		// otherwise only surface minutes into a plan generation.
		if err := services.ValidateGeminiAPIKey(r.Context(), apiKey); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}

	// A NULL key means "use the shared credits", so the empty string is stored
	// as NULL rather than as a key nobody can use.
	var storedKey *string
	if apiKey != "" {
		storedKey = &apiKey
	}
	var storedModel *string
	if model != "" {
		storedModel = &model
	}
	if _, err := h.db.Pool.Exec(r.Context(),
		`INSERT INTO user_llm_settings (user_id, provider, api_key, model)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id) DO UPDATE SET provider = EXCLUDED.provider,
		 api_key = EXCLUDED.api_key, model = EXCLUDED.model, updated_at = NOW()`,
		userID, provider, storedKey, storedModel); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save llm settings"})
		return
	}

	settings, err := h.loadSettings(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load llm settings"})
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// MockSubscription flips the subscription flag and nothing else. There is no
// payment behind it: it exists so the subscription flow can be built and tried
// end to end before a real provider is plugged in.
func (h *LLMSettingsHandler) MockSubscription(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.MockSubscriptionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	var status string
	switch strings.ToLower(strings.TrimSpace(req.Action)) {
	case "subscribe":
		status = "active"
	case "cancel":
		status = "cancelled"
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "action deve ser subscribe ou cancel"})
		return
	}

	if _, err := h.db.Pool.Exec(r.Context(),
		`INSERT INTO user_llm_settings (user_id, subscription_status, subscription_updated_at)
		 VALUES ($1, $2, NOW())
		 ON CONFLICT (user_id) DO UPDATE SET subscription_status = EXCLUDED.subscription_status,
		 subscription_updated_at = NOW(), updated_at = NOW()`,
		userID, status); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save subscription"})
		return
	}

	settings, err := h.loadSettings(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load llm settings"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mock": true, "settings": settings})
}

func (h *LLMSettingsHandler) loadSettings(ctx context.Context, userID int64) (models.LLMSettings, error) {
	settings := models.LLMSettings{Provider: "gemini", SubscriptionStatus: "free", UsingSharedCredits: true}
	var apiKey, model string
	err := h.db.Pool.QueryRow(ctx,
		`SELECT provider, COALESCE(api_key, ''), COALESCE(model, ''), subscription_status
		 FROM user_llm_settings WHERE user_id = $1`, userID,
	).Scan(&settings.Provider, &apiKey, &model, &settings.SubscriptionStatus)
	if err == pgx.ErrNoRows {
		return settings, nil
	}
	if err != nil {
		return settings, err
	}
	settings.Model = model
	settings.Configured = apiKey != ""
	settings.KeyPreview = previewAPIKey(apiKey)
	settings.UsingSharedCredits = apiKey == ""
	return settings, nil
}

// previewAPIKey shows only the last four characters. It is enough for the
// person to tell which key is saved, and useless to anyone who intercepts it.
func previewAPIKey(apiKey string) string {
	if apiKey == "" {
		return ""
	}
	runes := []rune(apiKey)
	if len(runes) <= 4 {
		return "…"
	}
	return "…" + string(runes[len(runes)-4:])
}
