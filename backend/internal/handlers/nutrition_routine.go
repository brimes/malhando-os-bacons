package handlers

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

// missingDaysWindow is the lookback for both GetRoutine's universe and
// GetMissingDays' calendar scan — see each handler's comment for what it
// means in that context.
const routineUniverseDays = 30
const missingDaysWindow = 30

// GetRoutine answers "what does a normal day look like", computed
// deterministically from history (services.DistillRoutine) — no LLM, so the
// same logs always give the same answer. The universe is the last 30
// distinct days that have at least one food_log, not the last 30 calendar
// days: gaps in the history must not shrink the sample the routine is built
// from.
func (h *NutritionHandler) GetRoutine(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(), `
		SELECT food_item_id, food_name, meal_type, quantity_g, calories, protein_g, carbs_g, fat_g, date
		FROM food_logs
		WHERE user_id = $1 AND date::date IN (
			SELECT DISTINCT date::date FROM food_logs WHERE user_id = $1 ORDER BY date::date DESC LIMIT $2
		)
		-- Deterministic row order: when the same food was logged under two
		-- different spellings (a renamed item, or free text typed two ways),
		-- DistillRoutine picks the display name from whichever row it sees
		-- first — without this, that pick (never the medians, which are order
		-- independent) could flap between calls on identical data.
		ORDER BY date, id`, userID, routineUniverseDays)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch nutrition history"})
		return
	}
	defer rows.Close()

	logs := []models.FoodLog{}
	for rows.Next() {
		var log models.FoodLog
		if err := rows.Scan(&log.FoodItemID, &log.FoodName, &log.MealType, &log.QuantityG,
			&log.Calories, &log.ProteinG, &log.CarbsG, &log.FatG, &log.Date); err != nil {
			continue
		}
		logs = append(logs, log)
	}

	writeJSON(w, http.StatusOK, services.DistillRoutine(logs))
}

// GetMissingDays answers which of the last 30 calendar days (not counting
// today, still in progress) have no food_log at all — the "dias esquecidos"
// card's source. Never reaches back past the person's first log: a day
// before the account had any history is not a forgotten day, it is an
// invented one.
func (h *NutritionHandler) GetMissingDays(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var firstLog time.Time
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT date::date FROM food_logs WHERE user_id = $1 ORDER BY date::date ASC LIMIT 1`, userID,
	).Scan(&firstLog)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusOK, models.MissingDaysResponse{Days: []string{}})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch nutrition history"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT DISTINCT date::date FROM food_logs
		 WHERE user_id = $1 AND date::date >= CURRENT_DATE - $2::int AND date::date < CURRENT_DATE`,
		userID, missingDaysWindow)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch nutrition history"})
		return
	}
	defer rows.Close()

	logged := map[string]bool{}
	for rows.Next() {
		var d time.Time
		if err := rows.Scan(&d); err != nil {
			continue
		}
		logged[d.Format("2006-01-02")] = true
	}

	firstLogDate := firstLog.Format("2006-01-02")
	days := []string{}
	// Newest first (yesterday down to 30 days ago), stopping at the person's
	// own first log so no date before the account had history is offered.
	for i := 1; i <= missingDaysWindow; i++ {
		d := time.Now().AddDate(0, 0, -i)
		dateStr := d.Format("2006-01-02")
		if dateStr < firstLogDate {
			break
		}
		if !logged[dateStr] {
			days = append(days, dateStr)
		}
	}

	writeJSON(w, http.StatusOK, models.MissingDaysResponse{Days: days})
}
