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

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, user_id, name, date, notes, created_at
		 FROM workouts WHERE user_id = $1 ORDER BY date DESC LIMIT 50`,
		userID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch workouts"})
		return
	}
	defer rows.Close()

	workouts := []models.Workout{}
	for rows.Next() {
		var w models.Workout
		if err := rows.Scan(&w.ID, &w.UserID, &w.Name, &w.Date, &w.Notes, &w.CreatedAt); err != nil {
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

	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to begin transaction"})
		return
	}
	defer tx.Rollback(r.Context())

	var workout models.Workout
	err = tx.QueryRow(r.Context(),
		`INSERT INTO workouts (user_id, name, date, notes) VALUES ($1, $2, $3, $4)
		 RETURNING id, user_id, name, date, notes, created_at`,
		userID, req.Name, req.Date, req.Notes,
	).Scan(&workout.ID, &workout.UserID, &workout.Name, &workout.Date, &workout.Notes, &workout.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create workout"})
		return
	}

	for _, s := range req.Sets {
		var set models.WorkoutSet
		err = tx.QueryRow(r.Context(),
			`INSERT INTO workout_sets (workout_id, exercise_name, sets, reps, weight_kg)
			 VALUES ($1, $2, $3, $4, $5)
			 RETURNING id, workout_id, exercise_name, sets, reps, weight_kg, created_at`,
			workout.ID, s.ExerciseName, s.Sets, s.Reps, s.WeightKg,
		).Scan(&set.ID, &set.WorkoutID, &set.ExerciseName, &set.Sets, &set.Reps, &set.WeightKg, &set.CreatedAt)
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
		`SELECT id, user_id, name, date, notes, created_at FROM workouts WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&workout.ID, &workout.UserID, &workout.Name, &workout.Date, &workout.Notes, &workout.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workout not found"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, workout_id, exercise_name, sets, reps, weight_kg, created_at
		 FROM workout_sets WHERE workout_id = $1 ORDER BY created_at`,
		workout.ID,
	)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var s models.WorkoutSet
			if err := rows.Scan(&s.ID, &s.WorkoutID, &s.ExerciseName, &s.Sets, &s.Reps, &s.WeightKg, &s.CreatedAt); err == nil {
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
		`SELECT COUNT(*) FROM workouts WHERE user_id = $1`, userID,
	).Scan(&stats.TotalWorkouts)

	// This week
	h.db.Pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM workouts WHERE user_id = $1 AND date >= date_trunc('week', CURRENT_DATE)`, userID,
	).Scan(&stats.WorkoutsThisWeek)

	// This month
	h.db.Pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM workouts WHERE user_id = $1 AND date >= date_trunc('month', CURRENT_DATE)`, userID,
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
		`SELECT DISTINCT date::date FROM workouts WHERE user_id = $1 ORDER BY date::date DESC`,
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
