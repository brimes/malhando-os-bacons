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
	if dateStr := r.URL.Query().Get("date"); dateStr != "" {
		parsed, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid date format, use YYYY-MM-DD"})
			return
		}
		today = parsed
	}
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

	// Today's nutrition. Summed from food_logs' own snapshot columns, not
	// recomputed from food_items: a JOIN there silently drops every log with
	// no food_item_id (a photo, "já comi" from a plan, or a manual entry),
	// same reasoning as nutrition_plan.go's suggestion and nutrition_context.go.
	var summary models.NutritionSummary
	_ = h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(calories),0), COALESCE(SUM(protein_g),0), COALESCE(SUM(carbs_g),0), COALESCE(SUM(fat_g),0)
		 FROM food_logs WHERE user_id = $1 AND date::date = $2::date`,
		userID, today,
	).Scan(&summary.Calories, &summary.ProteinG, &summary.CarbsG, &summary.FatG)
	resp.TodayNutrition = summary

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

	h.fillTrainingSummary(r, userID, &resp)

	writeJSON(w, http.StatusOK, resp)
}

// fillTrainingSummary adds what the home screen needs to nudge the person:
// which workout is due, how long since the last one, and how the week is going.
func (h *DashboardHandler) fillTrainingSummary(r *http.Request, userID int64, resp *models.DashboardResponse) {
	ctx := r.Context()

	var lastDone time.Time
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT MAX(date) FROM workouts WHERE user_id = $1 AND status = 'completed'`,
		userID).Scan(&lastDone); err == nil && !lastDone.IsZero() {
		days := int(time.Since(lastDone).Hours() / 24)
		if days < 0 {
			days = 0
		}
		resp.DaysSinceLastWorkout = &days
	}

	// The day trained longest ago comes first; never-trained days come before
	// those, and a tie falls back to the order the days were registered.
	var next models.NextWorkout
	err := h.db.Pool.QueryRow(ctx,
		`SELECT p.id, p.name, d.id, d.name, d.focus, MAX(w.date) AS last_done
		 FROM training_plans p
		 JOIN training_plan_days d ON d.plan_id = p.id
		 LEFT JOIN workouts w ON w.training_plan_day_id = d.id AND w.status = 'completed'
		 WHERE p.user_id = $1 AND p.active
		 GROUP BY p.id, p.name, d.id, d.name, d.focus, d.day_number
		 ORDER BY MAX(w.date) ASC NULLS FIRST, d.day_number ASC
		 LIMIT 1`, userID,
	).Scan(&next.PlanID, &next.PlanName, &next.DayID, &next.DayName, &next.Focus, &next.LastDoneAt)
	if err == nil {
		resp.NextWorkout = &next
	}

	// Weekly performance against the active plan's target.
	var planName string
	var targetPerWeek int
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT name, days_per_week FROM training_plans
		 WHERE user_id = $1 AND active ORDER BY created_at DESC LIMIT 1`, userID,
	).Scan(&planName, &targetPerWeek); err != nil || targetPerWeek <= 0 {
		return
	}
	var doneThisWeek int
	_ = h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM workouts
		 WHERE user_id = $1 AND status = 'completed' AND date >= date_trunc('week', CURRENT_DATE)`,
		userID).Scan(&doneThisWeek)

	remaining := targetPerWeek - doneThisWeek
	if remaining < 0 {
		remaining = 0
	}
	// date_trunc('week') starts on Monday, matching the counting above.
	daysLeft := 8 - int(time.Now().Weekday())
	if time.Now().Weekday() == time.Sunday {
		daysLeft = 1
	}
	resp.WeeklyPerformance = &models.WeeklyPerformance{
		PlanName:       planName,
		TargetPerWeek:  targetPerWeek,
		DoneThisWeek:   doneThisWeek,
		Remaining:      remaining,
		DaysLeftInWeek: daysLeft,
		OnTrack:        remaining == 0,
		StillPossible:  remaining <= daysLeft,
	}
}
