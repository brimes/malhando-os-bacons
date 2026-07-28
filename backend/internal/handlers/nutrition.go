package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

type NutritionHandler struct {
	db *db.DB
}

func NewNutritionHandler(database *db.DB) *NutritionHandler {
	return &NutritionHandler{db: database}
}

func (h *NutritionHandler) ListPlans(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, user_id, name, calories_target, protein_target, carbs_target, fat_target, active
		 FROM nutrition_plans WHERE user_id = $1 ORDER BY active DESC, id DESC`,
		userID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch plans"})
		return
	}
	defer rows.Close()

	plans := []models.NutritionPlan{}
	for rows.Next() {
		var p models.NutritionPlan
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.CaloriesTarget,
			&p.ProteinTarget, &p.CarbsTarget, &p.FatTarget, &p.Active); err != nil {
			continue
		}
		plans = append(plans, p)
	}

	writeJSON(w, http.StatusOK, plans)
}

func (h *NutritionHandler) CreatePlan(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req models.CreateNutritionPlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.Name == "" || req.CaloriesTarget <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and calories_target are required"})
		return
	}

	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "transaction error"})
		return
	}
	defer tx.Rollback(r.Context())

	// Deactivate existing plans
	_, err = tx.Exec(r.Context(),
		`UPDATE nutrition_plans SET active = false WHERE user_id = $1`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update plans"})
		return
	}

	var plan models.NutritionPlan
	err = tx.QueryRow(r.Context(),
		`INSERT INTO nutrition_plans (user_id, name, calories_target, protein_target, carbs_target, fat_target, active)
		 VALUES ($1, $2, $3, $4, $5, $6, true)
		 RETURNING id, user_id, name, calories_target, protein_target, carbs_target, fat_target, active`,
		userID, req.Name, req.CaloriesTarget, req.ProteinTarget, req.CarbsTarget, req.FatTarget,
	).Scan(&plan.ID, &plan.UserID, &plan.Name, &plan.CaloriesTarget,
		&plan.ProteinTarget, &plan.CarbsTarget, &plan.FatTarget, &plan.Active)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create plan"})
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "commit error"})
		return
	}

	writeJSON(w, http.StatusCreated, plan)
}

func (h *NutritionHandler) GetLogs(w http.ResponseWriter, r *http.Request) {
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
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid date format, use YYYY-MM-DD"})
			return
		}
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT fl.id, fl.user_id, fl.food_item_id, fl.meal_type, fl.quantity_g, fl.date, fl.created_at,
		        fi.id, fi.name, fi.calories_per_100g, fi.protein_g, fi.carbs_g, fi.fat_g, fi.source
		 FROM food_logs fl
		 JOIN food_items fi ON fi.id = fl.food_item_id
		 WHERE fl.user_id = $1 AND fl.date::date = $2::date
		 ORDER BY fl.created_at`,
		userID, date,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch logs"})
		return
	}
	defer rows.Close()

	logs := []models.FoodLog{}
	for rows.Next() {
		var log models.FoodLog
		var fi models.FoodItem
		if err := rows.Scan(
			&log.ID, &log.UserID, &log.FoodItemID, &log.MealType, &log.QuantityG, &log.Date, &log.CreatedAt,
			&fi.ID, &fi.Name, &fi.CaloriesPer100g, &fi.ProteinG, &fi.CarbsG, &fi.FatG, &fi.Source,
		); err != nil {
			continue
		}
		log.FoodItem = &fi
		ratio := log.QuantityG / 100.0
		log.Calories = fi.CaloriesPer100g * ratio
		log.ProteinG = fi.ProteinG * ratio
		log.CarbsG = fi.CarbsG * ratio
		log.FatG = fi.FatG * ratio
		logs = append(logs, log)
	}

	writeJSON(w, http.StatusOK, logs)
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

	if req.FoodItemID == 0 || req.QuantityG <= 0 || req.MealType == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "food_item_id, quantity_g, and meal_type are required"})
		return
	}

	validMeals := map[string]bool{"breakfast": true, "lunch": true, "dinner": true, "snack": true}
	if !validMeals[req.MealType] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "meal_type must be: breakfast, lunch, dinner, or snack"})
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

	var log models.FoodLog
	err := h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO food_logs (user_id, food_item_id, meal_type, quantity_g, date)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, user_id, food_item_id, meal_type, quantity_g, date, created_at`,
		userID, req.FoodItemID, req.MealType, req.QuantityG, logDate,
	).Scan(&log.ID, &log.UserID, &log.FoodItemID, &log.MealType, &log.QuantityG, &log.Date, &log.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create food log"})
		return
	}

	writeJSON(w, http.StatusCreated, log)
}

func (h *NutritionHandler) SearchFoods(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "query parameter 'q' is required"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, name, calories_per_100g, protein_g, carbs_g, fat_g, COALESCE(source, '') as source
		 FROM food_items WHERE name ILIKE '%' || $1 || '%' ORDER BY name LIMIT 20`,
		q,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "search failed"})
		return
	}
	defer rows.Close()

	foods := []models.FoodItem{}
	for rows.Next() {
		var f models.FoodItem
		if err := rows.Scan(&f.ID, &f.Name, &f.CaloriesPer100g, &f.ProteinG, &f.CarbsG, &f.FatG, &f.Source); err != nil {
			continue
		}
		foods = append(foods, f)
	}

	writeJSON(w, http.StatusOK, foods)
}

func (h *NutritionHandler) Calendar(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	start, end, err := parseMonth(r.URL.Query().Get("month"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid month format, use YYYY-MM"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT fl.date::date, COALESCE(SUM(fi.calories_per_100g * fl.quantity_g / 100.0), 0)
		 FROM food_logs fl JOIN food_items fi ON fi.id = fl.food_item_id
		 WHERE fl.user_id = $1 AND fl.date >= $2 AND fl.date < $3
		 GROUP BY fl.date::date ORDER BY fl.date::date`, userID, start, end)
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
