package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

type StepsHandler struct {
	db *db.DB
}

func NewStepsHandler(database *db.DB) *StepsHandler {
	return &StepsHandler{db: database}
}

func (h *StepsHandler) GetToday(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	dateStr := r.URL.Query().Get("date")
	var date time.Time
	if dateStr == "" {
		date = time.Now()
	} else {
		var err error
		date, err = time.Parse("2006-01-02", dateStr)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid date format"})
			return
		}
	}

	var steps models.Steps
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT id, user_id, date, count, calories_burned, source
		 FROM steps WHERE user_id = $1 AND date::date = $2::date`,
		userID, date,
	).Scan(&steps.ID, &steps.UserID, &steps.Date, &steps.Count, &steps.CaloriesBurned, &steps.Source)

	if err != nil {
		// Return empty steps if not found
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"date":            date.Format("2006-01-02"),
			"count":           0,
			"calories_burned": 0,
		})
		return
	}

	writeJSON(w, http.StatusOK, steps)
}

func (h *StepsHandler) Sync(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req models.SyncStepsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.Count < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "count must be non-negative"})
		return
	}

	stepDate := time.Now()
	if req.Date != "" {
		var err error
		stepDate, err = time.Parse("2006-01-02", req.Date)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid date format"})
			return
		}
	}

	if req.Source == "" {
		req.Source = "galaxy_watch"
	}

	var steps models.Steps
	err := h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO steps (user_id, date, count, calories_burned, source)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (user_id, date::date) DO UPDATE
		 SET count = EXCLUDED.count,
		     calories_burned = EXCLUDED.calories_burned,
		     source = EXCLUDED.source
		 RETURNING id, user_id, date, count, calories_burned, source`,
		userID, stepDate, req.Count, req.CaloriesBurned, req.Source,
	).Scan(&steps.ID, &steps.UserID, &steps.Date, &steps.Count, &steps.CaloriesBurned, &steps.Source)

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to sync steps"})
		return
	}

	writeJSON(w, http.StatusOK, steps)
}
