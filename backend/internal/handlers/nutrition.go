package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

var validMealTypes = map[string]bool{"breakfast": true, "lunch": true, "dinner": true, "snack": true}

type NutritionHandler struct {
	db       *db.DB
	resolver services.GeneratorResolver
	photoDir string
}

func NewNutritionHandler(database *db.DB, resolver services.GeneratorResolver, photoDir string) *NutritionHandler {
	return &NutritionHandler{db: database, resolver: resolver, photoDir: photoDir}
}

// maxLogsRangeDays caps `from`/`to` so the local-first pull (`lib/local/repo/foodLogs.ts`'s
// 60-day sliding window) cannot be abused into a full-history dump in one request.
const maxLogsRangeDays = 90

const foodLogsSelect = `SELECT fl.id, fl.user_id, fl.food_item_id, fl.food_name, fl.meal_type, fl.quantity_g,
	        fl.calories, fl.protein_g, fl.carbs_g, fl.fat_g, fl.origin, fl.client_log_id,
	        mp.id, fl.date, fl.created_at, fl.updated_at
	 FROM food_logs fl
	 LEFT JOIN meal_photos mp ON mp.food_log_id = fl.id
	 WHERE fl.user_id = $1 AND `

func scanFoodLogRows(rows pgx.Rows) []models.FoodLog {
	logs := []models.FoodLog{}
	for rows.Next() {
		var log models.FoodLog
		if err := rows.Scan(
			&log.ID, &log.UserID, &log.FoodItemID, &log.FoodName, &log.MealType, &log.QuantityG,
			&log.Calories, &log.ProteinG, &log.CarbsG, &log.FatG, &log.Origin, &log.ClientLogID,
			&log.PhotoID, &log.Date, &log.CreatedAt, &log.UpdatedAt,
		); err != nil {
			continue
		}
		logs = append(logs, log)
	}
	return logs
}

// GetLogs answers either a single day (`date`, or today when omitted — the
// original, still-default shape every existing caller uses) or a range
// (`from`+`to`, both required together) — the sliding-window pull the
// local-first repo needs to refetch 60 days in one request instead of 60.
// Purely additive: a request with neither carries on exactly as before.
func (h *NutritionHandler) GetLogs(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	if fromStr != "" || toStr != "" {
		if fromStr == "" || toStr == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "from e to devem ser usados juntos, no formato YYYY-MM-DD"})
			return
		}
		from, err := time.Parse("2006-01-02", fromStr)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid from date format, use YYYY-MM-DD"})
			return
		}
		to, err := time.Parse("2006-01-02", toStr)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid to date format, use YYYY-MM-DD"})
			return
		}
		if to.Before(from) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to não pode ser anterior a from"})
			return
		}
		if to.Sub(from) > maxLogsRangeDays*24*time.Hour {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "o intervalo entre from e to não pode passar de 90 dias"})
			return
		}

		rows, err := h.db.Pool.Query(r.Context(),
			foodLogsSelect+`fl.date::date >= $2::date AND fl.date::date <= $3::date ORDER BY fl.created_at`,
			userID, from, to,
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch logs"})
			return
		}
		defer rows.Close()
		writeJSON(w, http.StatusOK, scanFoodLogRows(rows))
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
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid date format, use YYYY-MM-DD"})
			return
		}
	}

	rows, err := h.db.Pool.Query(r.Context(),
		foodLogsSelect+`fl.date::date = $2::date ORDER BY fl.created_at`,
		userID, date,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch logs"})
		return
	}
	defer rows.Close()
	writeJSON(w, http.StatusOK, scanFoodLogRows(rows))
}

func (h *NutritionHandler) CreateLog(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req models.CreateFoodLogRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.QuantityG <= 0 || !validMealTypes[req.MealType] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "quantity_g e meal_type (breakfast, lunch, dinner ou snack) são obrigatórios"})
		return
	}
	if req.FoodItemID == nil && strings.TrimSpace(req.FoodName) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "food_item_id ou food_name é obrigatório"})
		return
	}
	origin := req.Origin
	validOrigins := map[string]bool{"manual": true, "plan": true, "photo_plate": true, "photo_label": true, "cheat_day": true}
	if origin == "" {
		origin = "manual"
	}
	if !validOrigins[origin] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "origin inválido"})
		return
	}

	logDate := time.Now()
	if req.Date != "" {
		var err error
		logDate, err = time.Parse("2006-01-02", req.Date)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid date format"})
			return
		}
	}

	foodName := strings.TrimSpace(req.FoodName)
	calories, proteinG, carbsG, fatG := req.Calories, req.ProteinG, req.CarbsG, req.FatG
	if req.FoodItemID != nil {
		var fi models.FoodItem
		err := h.db.Pool.QueryRow(r.Context(),
			`SELECT name, calories_per_100g, protein_g, carbs_g, fat_g FROM food_items WHERE id=$1 AND (user_id IS NULL OR user_id=$2)`,
			*req.FoodItemID, userID).Scan(&fi.Name, &fi.CaloriesPer100g, &fi.ProteinG, &fi.CarbsG, &fi.FatG)
		if err == pgx.ErrNoRows {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "alimento não encontrado"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load food item"})
			return
		}
		ratio := req.QuantityG / 100.0
		foodName = fi.Name
		calories = round2(fi.CaloriesPer100g * ratio)
		proteinG = round2(fi.ProteinG * ratio)
		carbsG = round2(fi.CarbsG * ratio)
		fatG = round2(fi.FatG * ratio)
	}

	var clientLogID *string
	if strings.TrimSpace(req.ClientLogID) != "" {
		trimmed := strings.TrimSpace(req.ClientLogID)
		clientLogID = &trimmed
	}

	var log models.FoodLog
	err := h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO food_logs (user_id, food_item_id, food_name, meal_type, quantity_g, calories, protein_g, carbs_g, fat_g, date, origin, client_log_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		 RETURNING id, user_id, food_item_id, food_name, meal_type, quantity_g, calories, protein_g, carbs_g, fat_g, origin, client_log_id, date, created_at, updated_at`,
		userID, req.FoodItemID, foodName, req.MealType, req.QuantityG, calories, proteinG, carbsG, fatG, logDate, origin, clientLogID,
	).Scan(&log.ID, &log.UserID, &log.FoodItemID, &log.FoodName, &log.MealType, &log.QuantityG,
		&log.Calories, &log.ProteinG, &log.CarbsG, &log.FatG, &log.Origin, &log.ClientLogID, &log.Date, &log.CreatedAt, &log.UpdatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		// A replay of the offline queue collides on idx_food_logs_client_id: the
		// row this key already created is returned as-is, so retrying is safe.
		if clientLogID != nil && errors.As(err, &pgErr) && pgErr.Code == "23505" {
			existing, lookupErr := h.findLogByClientID(r.Context(), userID, *clientLogID)
			if lookupErr == nil {
				writeJSON(w, http.StatusOK, existing)
				return
			}
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create food log"})
		return
	}
	if req.PhotoID != nil {
		// The log was created successfully; losing the photo link is not fatal.
		_, _ = h.db.Pool.Exec(r.Context(),
			`UPDATE meal_photos SET food_log_id=$1 WHERE id=$2 AND user_id=$3`, log.ID, *req.PhotoID, userID)
	}

	writeJSON(w, http.StatusCreated, log)
}

func (h *NutritionHandler) findLogByClientID(ctx context.Context, userID int64, clientLogID string) (models.FoodLog, error) {
	var log models.FoodLog
	err := h.db.Pool.QueryRow(ctx,
		`SELECT id, user_id, food_item_id, food_name, meal_type, quantity_g, calories, protein_g, carbs_g, fat_g, origin, client_log_id, date, created_at, updated_at
		 FROM food_logs WHERE user_id=$1 AND client_log_id=$2`, userID, clientLogID,
	).Scan(&log.ID, &log.UserID, &log.FoodItemID, &log.FoodName, &log.MealType, &log.QuantityG,
		&log.Calories, &log.ProteinG, &log.CarbsG, &log.FatG, &log.Origin, &log.ClientLogID, &log.Date, &log.CreatedAt, &log.UpdatedAt)
	return log, err
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

func (h *NutritionHandler) UpdateLog(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid log id"})
		return
	}
	var req models.UpdateFoodLogRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	// Mirrors the CHECK constraints in migrations 001/018_food_logs.sql:
	// quantity_g and calories are NUMERIC(8,2) (max 999999.99), the macros are
	// NUMERIC(6,2) (max 9999.99), none can be negative. Validating here keeps
	// the offline retry queue from burning MAX_MUTATION_ATTEMPTS on what is
	// really a 400.
	const maxNumeric82 = 999999.99
	const maxNumeric62 = 9999.99
	if req.QuantityG <= 0 || req.QuantityG > maxNumeric82 || !validMealTypes[req.MealType] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "quantity_g e meal_type são obrigatórios, e quantity_g deve estar dentro da faixa válida"})
		return
	}
	var foodName *string
	if req.FoodName != nil {
		trimmed := strings.TrimSpace(*req.FoodName)
		if trimmed == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "food_name não pode ser vazio"})
			return
		}
		foodName = &trimmed
	}
	if req.Calories != nil && (*req.Calories < 0 || *req.Calories > maxNumeric82) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "calories deve estar dentro da faixa válida"})
		return
	}
	if req.ProteinG != nil && (*req.ProteinG < 0 || *req.ProteinG > maxNumeric62) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "protein_g deve estar dentro da faixa válida"})
		return
	}
	if req.CarbsG != nil && (*req.CarbsG < 0 || *req.CarbsG > maxNumeric62) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "carbs_g deve estar dentro da faixa válida"})
		return
	}
	if req.FatG != nil && (*req.FatG < 0 || *req.FatG > maxNumeric62) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "fat_g deve estar dentro da faixa válida"})
		return
	}

	var current models.FoodLog
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT food_item_id, food_name, quantity_g, calories, protein_g, carbs_g, fat_g FROM food_logs WHERE id=$1 AND user_id=$2`,
		id, userID).Scan(&current.FoodItemID, &current.FoodName, &current.QuantityG, &current.Calories, &current.ProteinG, &current.CarbsG, &current.FatG)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "food log not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load food log"})
		return
	}

	newFoodItemID := current.FoodItemID
	newFoodName := current.FoodName
	calories, proteinG, carbsG, fatG := current.Calories, current.ProteinG, current.CarbsG, current.FatG

	// EditFoodLogModal always sends all 7 fields, including when the person
	// only touched the quantity — it live-rescales the macro fields on screen
	// proportionally so what is displayed matches what gets saved. That means
	// "a macro was sent" can no longer stand in for "a macro was edited by
	// hand": it is also true of a value the client itself computed from the
	// same ratio the old rescale branch below would have produced. Comparing
	// against the ratio-scaled expectation (not the raw pre-edit value)
	// distinguishes the two — only a value that formula could not have
	// produced is an authorial correction.
	ratio := 1.0
	if current.QuantityG > 0 {
		ratio = req.QuantityG / current.QuantityG
	}
	// Tolerance absorbs float round-trip through JSON and any rounding-mode
	// difference between the client's live rescale and round2 here — both
	// round to 2 decimals, so a genuine mismatch is never this small.
	const macroTolerance = 0.01
	nearlyEqual := func(a, b float64) bool {
		diff := a - b
		if diff < 0 {
			diff = -diff
		}
		return diff < macroTolerance
	}
	nameChanged := foodName != nil && *foodName != current.FoodName
	caloriesChanged := req.Calories != nil && !nearlyEqual(*req.Calories, round2(current.Calories*ratio))
	proteinChanged := req.ProteinG != nil && !nearlyEqual(*req.ProteinG, round2(current.ProteinG*ratio))
	carbsChanged := req.CarbsG != nil && !nearlyEqual(*req.CarbsG, round2(current.CarbsG*ratio))
	fatChanged := req.FatG != nil && !nearlyEqual(*req.FatG, round2(current.FatG*ratio))

	// Editing the name or any macro by hand is an authorial correction — those
	// values must stick exactly as sent, not get rescaled on top. It also means
	// the row stops tracking the catalog (CreateLog/GetLogs would otherwise
	// keep recomputing macros from a food_item_id later), the same reasoning
	// migration 018 already applied to keep a snapshot instead of a live
	// reference. An edit that only moves the quantity or the meal (no name, no
	// macro actually changed) keeps the old rescale-by-ratio behavior and the
	// catalog link untouched.
	explicit := nameChanged || caloriesChanged || proteinChanged || carbsChanged || fatChanged
	if explicit {
		newFoodItemID = nil
		if foodName != nil {
			newFoodName = *foodName
		}
		if req.Calories != nil {
			calories = *req.Calories
		}
		if req.ProteinG != nil {
			proteinG = *req.ProteinG
		}
		if req.CarbsG != nil {
			carbsG = *req.CarbsG
		}
		if req.FatG != nil {
			fatG = *req.FatG
		}
	} else if current.QuantityG > 0 {
		// Rescale the snapshotted macros by the new quantity relative to the old
		// one, so editing "170g em vez de 150g" keeps the same per-gram ratio
		// instead of requiring a fresh catalog lookup (a free-text or photo log
		// has none). Same ratio already computed above to decide `explicit`.
		calories, proteinG, carbsG, fatG = round2(calories*ratio), round2(proteinG*ratio), round2(carbsG*ratio), round2(fatG*ratio)
	}

	var log models.FoodLog
	err = h.db.Pool.QueryRow(r.Context(),
		`UPDATE food_logs SET quantity_g=$3, meal_type=$4, food_name=$5, calories=$6, protein_g=$7, carbs_g=$8, fat_g=$9, food_item_id=$10, updated_at=NOW()
		 WHERE id=$1 AND user_id=$2
		 RETURNING id, user_id, food_item_id, food_name, meal_type, quantity_g, calories, protein_g, carbs_g, fat_g, origin, client_log_id, date, created_at, updated_at`,
		id, userID, req.QuantityG, req.MealType, newFoodName, calories, proteinG, carbsG, fatG, newFoodItemID,
	).Scan(&log.ID, &log.UserID, &log.FoodItemID, &log.FoodName, &log.MealType, &log.QuantityG,
		&log.Calories, &log.ProteinG, &log.CarbsG, &log.FatG, &log.Origin, &log.ClientLogID, &log.Date, &log.CreatedAt, &log.UpdatedAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "food log not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update food log"})
		return
	}
	writeJSON(w, http.StatusOK, log)
}

func (h *NutritionHandler) DeleteLog(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid log id"})
		return
	}
	tag, err := h.db.Pool.Exec(r.Context(), `DELETE FROM food_logs WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete food log"})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "food log not found"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NutritionHandler) Calendar(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	start, end, err := parseMonth(r.URL.Query().Get("month"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid month format, use YYYY-MM"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT date::date, COALESCE(SUM(calories), 0)
		 FROM food_logs
		 WHERE user_id = $1 AND date >= $2 AND date < $3
		 GROUP BY date::date ORDER BY date::date`, userID, start, end)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch nutrition calendar"})
		return
	}
	defer rows.Close()
	type calendarDay struct {
		Date     string  `json:"date"`
		Calories float64 `json:"calories"`
	}
	days := []calendarDay{}
	for rows.Next() {
		var date time.Time
		var calories float64
		if err := rows.Scan(&date, &calories); err != nil {
			continue
		}
		days = append(days, calendarDay{Date: date.Format("2006-01-02"), Calories: calories})
	}
	writeJSON(w, http.StatusOK, map[string]any{"month": start.Format("2006-01"), "days": days})
}
