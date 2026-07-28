package handlers

import (
	"net/http"
	"time"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

type DashboardHandler struct {
	db *db.DB
}

func NewDashboardHandler(database *db.DB) *DashboardHandler {
	return &DashboardHandler{db: database}
}

func (h *DashboardHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	ctx := r.Context()
	today := time.Now()
	resp := models.DashboardResponse{}

	// Fetch user
	h.db.Pool.QueryRow(ctx,
		`SELECT id, email, name, avatar_url, google_id, created_at FROM users WHERE id = $1`, userID,
	).Scan(&resp.User.ID, &resp.User.Email, &resp.User.Name,
		&resp.User.AvatarURL, &resp.User.GoogleID, &resp.User.CreatedAt)

	// Today's workout
	var workout models.Workout
	err := h.db.Pool.QueryRow(ctx,
		`SELECT id, user_id, name, date, notes, created_at FROM workouts
		 WHERE user_id = $1 AND status = 'completed' AND date::date = $2::date ORDER BY created_at DESC LIMIT 1`,
		userID, today,
	).Scan(&workout.ID, &workout.UserID, &workout.Name, &workout.Date, &workout.Notes, &workout.CreatedAt)
	if err == nil {
		resp.TodayWorkout = &workout
	}

	// Workout stats
	h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM workouts WHERE user_id = $1 AND status = 'completed'`, userID,
	).Scan(&resp.WorkoutStats.TotalWorkouts)

	h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM workouts WHERE user_id = $1 AND status = 'completed' AND date >= date_trunc('week', CURRENT_DATE)`, userID,
	).Scan(&resp.WorkoutStats.WorkoutsThisWeek)

	h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(ws.sets * ws.reps * ws.weight_kg), 0)
		 FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id WHERE w.user_id = $1`, userID,
	).Scan(&resp.WorkoutStats.TotalSets, &resp.WorkoutStats.TotalVolume)

	// Weekly workouts
	wRows, err := h.db.Pool.Query(ctx,
		`SELECT id, user_id, name, date, notes, created_at FROM workouts
		 WHERE user_id = $1 AND status = 'completed' AND date >= date_trunc('week', CURRENT_DATE) ORDER BY date DESC`,
		userID,
	)
	if err == nil {
		defer wRows.Close()
		for wRows.Next() {
			var wk models.Workout
			if err := wRows.Scan(&wk.ID, &wk.UserID, &wk.Name, &wk.Date, &wk.Notes, &wk.CreatedAt); err == nil {
				resp.WeeklyWorkouts = append(resp.WeeklyWorkouts, wk)
			}
		}
	}

	// Today's nutrition
	nRows, err := h.db.Pool.Query(ctx,
		`SELECT fl.quantity_g, fi.calories_per_100g, fi.protein_g, fi.carbs_g, fi.fat_g
		 FROM food_logs fl JOIN food_items fi ON fi.id = fl.food_item_id
		 WHERE fl.user_id = $1 AND fl.date::date = $2::date`,
		userID, today,
	)
	if err == nil {
		defer nRows.Close()
		var summary models.NutritionSummary
		for nRows.Next() {
			var qty, cal, prot, carb, fat float64
			if err := nRows.Scan(&qty, &cal, &prot, &carb, &fat); err == nil {
				ratio := qty / 100.0
				summary.Calories += cal * ratio
				summary.ProteinG += prot * ratio
				summary.CarbsG += carb * ratio
				summary.FatG += fat * ratio
			}
		}
		resp.TodayNutrition = summary
	}

	// Active nutrition plan
	var plan models.NutritionPlan
	err = h.db.Pool.QueryRow(ctx,
		`SELECT id, user_id, name, calories_target, protein_target, carbs_target, fat_target, active
		 FROM nutrition_plans WHERE user_id = $1 AND active = true LIMIT 1`,
		userID,
	).Scan(&plan.ID, &plan.UserID, &plan.Name, &plan.CaloriesTarget,
		&plan.ProteinTarget, &plan.CarbsTarget, &plan.FatTarget, &plan.Active)
	if err == nil {
		resp.ActivePlan = &plan
	}

	// Today's steps
	var steps models.Steps
	err = h.db.Pool.QueryRow(ctx,
		`SELECT id, user_id, date, count, calories_burned, source
		 FROM steps WHERE user_id = $1 AND date::date = $2::date`,
		userID, today,
	).Scan(&steps.ID, &steps.UserID, &steps.Date, &steps.Count, &steps.CaloriesBurned, &steps.Source)
	if err == nil {
		resp.TodaySteps = &steps
	}

	writeJSON(w, http.StatusOK, resp)
}
