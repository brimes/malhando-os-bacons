package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

type WorkoutHandler struct {
	db *db.DB
}

func NewWorkoutHandler(database *db.DB) *WorkoutHandler {
	return &WorkoutHandler{db: database}
}

func (h *WorkoutHandler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	// ?date=YYYY-MM-DD narrows to a single day, used when a day is opened in the
	// history calendar. Without it the query keeps the recent-workouts behaviour.
	var day *time.Time
	if raw := strings.TrimSpace(r.URL.Query().Get("date")); raw != "" {
		parsed, err := time.Parse("2006-01-02", raw)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "date must be YYYY-MM-DD"})
			return
		}
		day = &parsed
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT w.id, w.user_id, w.name, w.date, w.notes, w.training_plan_day_id, w.duration_minutes,
		 w.status, w.started_at, w.finished_at, w.created_at,
		 (SELECT COUNT(*) FROM workout_sets ws WHERE ws.workout_id = w.id) AS set_count
		 FROM workouts w
		 WHERE w.user_id = $1 AND w.status = 'completed'
		   AND ($2::date IS NULL OR w.date::date = $2::date)
		 ORDER BY w.date DESC
		 LIMIT CASE WHEN $2::date IS NULL THEN 50 ELSE 100 END`,
		userID, day,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch workouts"})
		return
	}
	defer rows.Close()

	workouts := []models.Workout{}
	for rows.Next() {
		var w models.Workout
		if err := rows.Scan(&w.ID, &w.UserID, &w.Name, &w.Date, &w.Notes, &w.TrainingPlanDayID, &w.DurationMinutes,
			&w.Status, &w.StartedAt, &w.FinishedAt, &w.CreatedAt, &w.SetCount); err != nil {
			continue
		}
		workouts = append(workouts, w)
	}

	writeJSON(w, http.StatusOK, workouts)
}

func (h *WorkoutHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req models.CreateWorkoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "workout name is required"})
		return
	}

	if req.Date.IsZero() {
		req.Date = time.Now()
	}
	if req.DurationMinutes != nil && (*req.DurationMinutes < 1 || *req.DurationMinutes > 600) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "duration_minutes must be between 1 and 600"})
		return
	}
	if req.TrainingPlanDayID != nil {
		var allowed bool
		err := h.db.Pool.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM training_plan_days d JOIN training_plans p ON p.id = d.plan_id
			 WHERE d.id = $1 AND p.user_id = $2)`, *req.TrainingPlanDayID, userID).Scan(&allowed)
		if err != nil || !allowed {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid training plan day"})
			return
		}
	}

	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to begin transaction"})
		return
	}
	defer tx.Rollback(r.Context())

	var workout models.Workout
	err = tx.QueryRow(r.Context(),
		`INSERT INTO workouts (user_id, name, date, notes, training_plan_day_id, duration_minutes)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, user_id, name, date, notes, training_plan_day_id, duration_minutes, created_at`,
		userID, req.Name, req.Date, req.Notes, req.TrainingPlanDayID, req.DurationMinutes,
	).Scan(&workout.ID, &workout.UserID, &workout.Name, &workout.Date, &workout.Notes,
		&workout.TrainingPlanDayID, &workout.DurationMinutes, &workout.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create workout"})
		return
	}

	for _, s := range req.Sets {
		if s.TrackingType == "" {
			s.TrackingType = "reps"
		}
		if s.TrackingType != "reps" && s.TrackingType != "time" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid exercise tracking type"})
			return
		}
		var set models.WorkoutSet
		err = tx.QueryRow(r.Context(),
			`INSERT INTO workout_sets (workout_id, exercise_name, sets, reps, weight_kg, tracking_type, duration_seconds)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 RETURNING id, workout_id, exercise_name, sets, reps, weight_kg, tracking_type, duration_seconds, created_at`,
			workout.ID, s.ExerciseName, s.Sets, s.Reps, s.WeightKg, s.TrackingType, s.DurationSeconds,
		).Scan(&set.ID, &set.WorkoutID, &set.ExerciseName, &set.Sets, &set.Reps, &set.WeightKg,
			&set.TrackingType, &set.DurationSeconds, &set.CreatedAt)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create workout set"})
			return
		}
		workout.Sets = append(workout.Sets, set)
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to commit transaction"})
		return
	}

	writeJSON(w, http.StatusCreated, workout)
}

func (h *WorkoutHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout id"})
		return
	}

	var workout models.Workout
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT id, user_id, name, date, notes, training_plan_day_id, duration_minutes,
		 status, started_at, finished_at, created_at
		 FROM workouts WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&workout.ID, &workout.UserID, &workout.Name, &workout.Date, &workout.Notes,
		&workout.TrainingPlanDayID, &workout.DurationMinutes,
		&workout.Status, &workout.StartedAt, &workout.FinishedAt, &workout.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workout not found"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, workout_id, exercise_name, sets, reps, weight_kg, tracking_type, duration_seconds, created_at
		 FROM workout_sets WHERE workout_id = $1 ORDER BY created_at`,
		workout.ID,
	)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var s models.WorkoutSet
			if err := rows.Scan(&s.ID, &s.WorkoutID, &s.ExerciseName, &s.Sets, &s.Reps, &s.WeightKg,
				&s.TrackingType, &s.DurationSeconds, &s.CreatedAt); err == nil {
				workout.Sets = append(workout.Sets, s)
			}
		}
	}

	writeJSON(w, http.StatusOK, workout)
}

func (h *WorkoutHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout id"})
		return
	}

	var req models.CreateWorkoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	var workout models.Workout
	err = h.db.Pool.QueryRow(r.Context(),
		`UPDATE workouts SET name = $1, date = $2, notes = $3
		 WHERE id = $4 AND user_id = $5
		 RETURNING id, user_id, name, date, notes, created_at`,
		req.Name, req.Date, req.Notes, id, userID,
	).Scan(&workout.ID, &workout.UserID, &workout.Name, &workout.Date, &workout.Notes, &workout.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workout not found"})
		return
	}

	writeJSON(w, http.StatusOK, workout)
}

func (h *WorkoutHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout id"})
		return
	}

	result, err := h.db.Pool.Exec(r.Context(),
		`DELETE FROM workouts WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete workout"})
		return
	}

	if result.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workout not found"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "workout deleted"})
}

func (h *WorkoutHandler) Stats(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var stats models.WorkoutStats

	// Total workouts
	h.db.Pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM workouts WHERE user_id = $1 AND status = 'completed'`, userID,
	).Scan(&stats.TotalWorkouts)

	// This week
	h.db.Pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM workouts WHERE user_id = $1 AND status = 'completed' AND date >= date_trunc('week', CURRENT_DATE)`, userID,
	).Scan(&stats.WorkoutsThisWeek)

	// This month
	h.db.Pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM workouts WHERE user_id = $1 AND status = 'completed' AND date >= date_trunc('month', CURRENT_DATE)`, userID,
	).Scan(&stats.WorkoutsThisMonth)

	// Total sets and volume
	h.db.Pool.QueryRow(r.Context(),
		`SELECT COUNT(*), COALESCE(SUM(ws.sets * ws.reps * ws.weight_kg), 0)
		 FROM workout_sets ws
		 JOIN workouts w ON w.id = ws.workout_id
		 WHERE w.user_id = $1`, userID,
	).Scan(&stats.TotalSets, &stats.TotalVolume)

	// Current streak
	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT DISTINCT date::date FROM workouts WHERE user_id = $1 AND status = 'completed' ORDER BY date::date DESC`,
		userID,
	)
	if err == nil {
		defer rows.Close()
		streak := 0
		expectedDate := time.Now().Truncate(24 * time.Hour)
		for rows.Next() {
			var d time.Time
			if err := rows.Scan(&d); err != nil {
				break
			}
			d = d.Truncate(24 * time.Hour)
			if d.Equal(expectedDate) || d.Equal(expectedDate.AddDate(0, 0, -1)) {
				streak++
				expectedDate = d.AddDate(0, 0, -1)
			} else {
				break
			}
		}
		stats.Streak = streak
	}

	writeJSON(w, http.StatusOK, stats)
}

func (h *WorkoutHandler) Calendar(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	start, end, err := parseMonth(r.URL.Query().Get("month"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid month format, use YYYY-MM"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT date::date, COUNT(*) FROM workouts
		 WHERE user_id = $1 AND status = 'completed' AND date >= $2 AND date < $3
		 GROUP BY date::date ORDER BY date::date`, userID, start, end)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch workout calendar"})
		return
	}
	defer rows.Close()
	type calendarDay struct {
		Date  string `json:"date"`
		Count int    `json:"count"`
	}
	days := []calendarDay{}
	for rows.Next() {
		var date time.Time
		var count int
		if err := rows.Scan(&date, &count); err != nil {
			continue
		}
		days = append(days, calendarDay{Date: date.Format("2006-01-02"), Count: count})
	}
	writeJSON(w, http.StatusOK, map[string]any{"month": start.Format("2006-01"), "days": days})
}

func parseMonth(value string) (time.Time, time.Time, error) {
	if value == "" {
		value = time.Now().Format("2006-01")
	}
	start, err := time.Parse("2006-01", value)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return start, start.AddDate(0, 1, 0), nil
}

func parseIDFromPath(path string) (int64, error) {
	parts := strings.Split(strings.TrimRight(path, "/"), "/")
	if len(parts) == 0 {
		return 0, strconv.ErrSyntax
	}
	return strconv.ParseInt(parts[len(parts)-1], 10, 64)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
