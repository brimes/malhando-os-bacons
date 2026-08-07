package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

type WorkoutSessionHandler struct {
	db *db.DB
}

func NewWorkoutSessionHandler(database *db.DB) *WorkoutSessionHandler {
	return &WorkoutSessionHandler{db: database}
}

// offlineKeyPattern accepts a UUID or any short opaque identifier the app may
// mint offline, for either a client_session_id or a client_set_id. Kept
// deliberately narrow so the value stays safe to log and to compare, and
// bounded so it cannot be used to stuff the column.
var offlineKeyPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// Start opens a session for a plan day. If one is already open it is returned
// as-is, so a double tap on "iniciar" never creates two workouts.
//
// When the app starts a session without connectivity it mints a client_session_id
// and queues this request. The queue may replay it (after a timeout, or once the
// network flaps), so a start carrying a client_session_id already seen for this
// user returns the workout it created the first time instead of creating another.
func (h *WorkoutSessionHandler) Start(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.StartWorkoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.ClientSessionID = strings.TrimSpace(req.ClientSessionID)
	if req.ClientSessionID != "" && !offlineKeyPattern.MatchString(req.ClientSessionID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "client_session_id inválido: use até 64 caracteres alfanuméricos ou hífen"})
		return
	}

	// A replay wins over every other rule: the workout this key already created
	// is returned as-is, finished or not, so retrying is always safe and never
	// resurrects nor duplicates a session.
	if req.ClientSessionID != "" {
		var existingID int64
		err := h.db.Pool.QueryRow(r.Context(),
			`SELECT id FROM workouts WHERE user_id = $1 AND client_session_id = $2`,
			userID, req.ClientSessionID).Scan(&existingID)
		if err == nil {
			h.writeActive(w, r, userID, existingID)
			return
		}
		if err != pgx.ErrNoRows {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to check client session"})
			return
		}
	}

	var dayName string
	var planID int64
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT d.name, p.id FROM training_plan_days d
		 JOIN training_plans p ON p.id = d.plan_id
		 WHERE d.id = $1 AND p.user_id = $2`, req.TrainingPlanDayID, userID).Scan(&dayName, &planID)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid training plan day"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load training plan day"})
		return
	}

	var existingID int64
	var existingDayID *int64
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT id, training_plan_day_id FROM workouts WHERE user_id = $1 AND status = 'in_progress'`,
		userID).Scan(&existingID, &existingDayID)
	if err != nil && err != pgx.ErrNoRows {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to check active workout"})
		return
	}
	if err == nil {
		// Same day: resume it, so a double tap never creates two workouts.
		if existingDayID != nil && *existingDayID == req.TrainingPlanDayID {
			h.writeActive(w, r, userID, existingID)
			return
		}
		// A different day is already open — only one session may exist at a time.
		writeJSON(w, http.StatusConflict, map[string]string{"error": "another workout is already in progress"})
		return
	}

	now := time.Now()
	var clientSessionID *string
	if req.ClientSessionID != "" {
		clientSessionID = &req.ClientSessionID
	}
	var workoutID int64
	err = h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO workouts (user_id, name, date, notes, training_plan_day_id, status, started_at, client_session_id)
		 VALUES ($1, $2, $3, '', $4, 'in_progress', $3, $5) RETURNING id`,
		userID, dayName, now, req.TrainingPlanDayID, clientSessionID).Scan(&workoutID)
	if err != nil {
		// Both partial unique indexes on workouts (one open session per user, one
		// row per client key) surface as 23505 here when replays of the queued
		// start land concurrently: the lookup above ran before the winner's
		// insert. Neither case is a 500.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			// A burst of identical replays violates both indexes at once, and the
			// index Postgres names then is arbitrary — so the key, not the
			// constraint name, decides. Postgres only raises the violation after
			// the winning transaction commits, so this lookup does see its row.
			if req.ClientSessionID != "" {
				var existingID int64
				if lookupErr := h.db.Pool.QueryRow(r.Context(),
					`SELECT id FROM workouts WHERE user_id = $1 AND client_session_id = $2`,
					userID, req.ClientSessionID).Scan(&existingID); lookupErr == nil {
					h.writeActive(w, r, userID, existingID)
					return
				}
			}
			// No row carries this key, so what collided was the single open session:
			// a different start claimed the slot. Same situation the app already
			// knows how to display, so reuse its conflict instead of a 500.
			writeJSON(w, http.StatusConflict, map[string]string{"error": "another workout is already in progress"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to start workout"})
		return
	}
	h.writeActive(w, r, userID, workoutID)
}

// Active returns the open session, or 204 when there is none.
func (h *WorkoutSessionHandler) Active(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var workoutID int64
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT id FROM workouts WHERE user_id = $1 AND status = 'in_progress'`, userID).Scan(&workoutID)
	if err == pgx.ErrNoRows {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load active workout"})
		return
	}
	h.writeActive(w, r, userID, workoutID)
}

// CompleteSet records one finished series and remembers the weight used.
//
// When the app logs a series without connectivity, or the connection drops
// after the server commits but before the response arrives, it mints a
// client_set_id and queues the request for replay. Because set_number is
// always derived here from a COUNT (never from what the client sends, so a
// stale button tap can't record extra series), a replay without an
// idempotency key is indistinguishable from a real extra series and used to
// be silently inserted as "the next legitimate one". A request carrying a
// client_set_id already seen for this workout returns the series it created
// the first time instead.
func (h *WorkoutSessionHandler) CompleteSet(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	workoutID, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout id"})
		return
	}
	var req models.CompleteSetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.ExerciseName = strings.TrimSpace(req.ExerciseName)
	req.ClientSetID = strings.TrimSpace(req.ClientSetID)
	if req.TrackingType == "" {
		req.TrackingType = "reps"
	}
	if req.ExerciseName == "" ||
		req.Reps < 1 || req.Reps > 1000 || req.WeightKg < 0 || req.WeightKg > 1000 ||
		(req.TrackingType != "reps" && req.TrackingType != "time") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid set data"})
		return
	}
	if req.ClientSetID != "" && !offlineKeyPattern.MatchString(req.ClientSetID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "client_set_id inválido: use até 64 caracteres alfanuméricos ou hífen"})
		return
	}

	if !h.ownsActiveWorkout(r, userID, workoutID) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "active workout not found"})
		return
	}

	// A replay wins over everything else below: if this key already recorded a
	// series for this workout, return that row as-is instead of computing a new
	// set_number and inserting again. This is the common case (the retry lands
	// after the original response was merely lost) and skips the write path
	// entirely.
	if req.ClientSetID != "" {
		existing, lookupErr := h.findSetByClientID(r.Context(), workoutID, req.ClientSetID)
		if lookupErr == nil {
			writeJSON(w, http.StatusOK, existing)
			return
		}
		if lookupErr != pgx.ErrNoRows {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save set"})
			return
		}
	}

	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save set"})
		return
	}
	defer tx.Rollback(r.Context())

	// The series number is derived here, never taken from the client: repeated
	// taps on "próximo" all send the same stale number, and two of them can be
	// in flight before the screen has caught up.
	setNumber := req.SetNumber
	if req.TrainingPlanExerciseID != nil {
		var plannedSets int
		// FOR UPDATE serialises concurrent inserts for this exercise, so the
		// count below cannot be read twice before either insert lands.
		err = tx.QueryRow(r.Context(),
			`SELECT e.sets FROM training_plan_exercises e
			 JOIN workouts w ON w.training_plan_day_id = e.plan_day_id
			 WHERE e.id = $1 AND w.id = $2 FOR UPDATE OF e`,
			*req.TrainingPlanExerciseID, workoutID).Scan(&plannedSets)
		if err == pgx.ErrNoRows {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "exercise does not belong to this workout"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save set"})
			return
		}
		var alreadyDone int
		if err := tx.QueryRow(r.Context(),
			`SELECT COUNT(*) FROM workout_sets WHERE workout_id = $1 AND training_plan_exercise_id = $2`,
			workoutID, *req.TrainingPlanExerciseID).Scan(&alreadyDone); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save set"})
			return
		}
		if alreadyDone >= plannedSets {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "all series for this exercise are already done"})
			return
		}
		setNumber = alreadyDone + 1
	}
	if setNumber < 1 || setNumber > 50 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid set number"})
		return
	}

	var clientSetID *string
	if req.ClientSetID != "" {
		clientSetID = &req.ClientSetID
	}

	var set models.WorkoutSet
	err = tx.QueryRow(r.Context(),
		`INSERT INTO workout_sets (workout_id, exercise_name, sets, reps, weight_kg, tracking_type,
		 duration_seconds, training_plan_exercise_id, set_number, client_set_id, completed_at)
		 VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,NOW())
		 RETURNING id, workout_id, exercise_name, sets, reps, tracking_type, duration_seconds,
		 weight_kg, training_plan_exercise_id, set_number, client_set_id, completed_at, created_at`,
		workoutID, req.ExerciseName, req.Reps, req.WeightKg, req.TrackingType,
		req.DurationSeconds, req.TrainingPlanExerciseID, setNumber, clientSetID,
	).Scan(&set.ID, &set.WorkoutID, &set.ExerciseName, &set.Sets, &set.Reps, &set.TrackingType,
		&set.DurationSeconds, &set.WeightKg, &set.TrainingPlanExerciseID, &set.SetNumber,
		&set.ClientSetID, &set.CompletedAt, &set.CreatedAt)
	if err != nil {
		// Two replays of the same client_set_id can both pass the pre-insert
		// lookup above (neither has committed yet) and then race here: the
		// FOR UPDATE lock on the plan exercise serialises them, so the loser
		// computes its set_number after the winner's insert and then collides
		// on the unique index instead. Same pattern as Start's
		// client_session_id race — the key, not a 500, decides the outcome.
		var pgErr *pgconn.PgError
		if req.ClientSetID != "" && errors.As(err, &pgErr) && pgErr.Code == "23505" {
			_ = tx.Rollback(r.Context())
			if existing, lookupErr := h.findSetByClientID(r.Context(), workoutID, req.ClientSetID); lookupErr == nil {
				writeJSON(w, http.StatusOK, existing)
				return
			}
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save set"})
		return
	}

	// Only a real load is worth remembering; bodyweight and timed work stay blank.
	if req.TrainingPlanExerciseID != nil && req.WeightKg > 0 {
		if _, err := tx.Exec(r.Context(),
			`UPDATE training_plan_exercises SET last_weight_kg = $2 WHERE id = $1`,
			*req.TrainingPlanExerciseID, req.WeightKg); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save set"})
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save set"})
		return
	}
	writeJSON(w, http.StatusCreated, set)
}

// findSetByClientID looks up a series already recorded under this idempotency
// key, so a replay — a legitimate retry, or two retries racing each other —
// can be answered with the row that already exists instead of inserting again.
func (h *WorkoutSessionHandler) findSetByClientID(ctx context.Context, workoutID int64, clientSetID string) (models.WorkoutSet, error) {
	var set models.WorkoutSet
	err := h.db.Pool.QueryRow(ctx,
		`SELECT id, workout_id, exercise_name, sets, reps, tracking_type, duration_seconds,
		 weight_kg, training_plan_exercise_id, set_number, client_set_id, completed_at, created_at
		 FROM workout_sets WHERE workout_id = $1 AND client_set_id = $2`,
		workoutID, clientSetID,
	).Scan(&set.ID, &set.WorkoutID, &set.ExerciseName, &set.Sets, &set.Reps, &set.TrackingType,
		&set.DurationSeconds, &set.WeightKg, &set.TrainingPlanExerciseID, &set.SetNumber,
		&set.ClientSetID, &set.CompletedAt, &set.CreatedAt)
	return set, err
}

// DeleteSet undoes the last recorded series, backing the session up one step.
func (h *WorkoutSessionHandler) DeleteSet(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	parts := strings.Split(strings.TrimRight(r.URL.Path, "/"), "/")
	if len(parts) < 2 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid path"})
		return
	}
	setID, err := strconv.ParseInt(parts[len(parts)-1], 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid set id"})
		return
	}
	workoutID, err := strconv.ParseInt(parts[len(parts)-3], 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout id"})
		return
	}
	if !h.ownsActiveWorkout(r, userID, workoutID) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "active workout not found"})
		return
	}
	result, err := h.db.Pool.Exec(r.Context(),
		`DELETE FROM workout_sets WHERE id = $1 AND workout_id = $2`, setID, workoutID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete set"})
		return
	}
	if result.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "set not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "set deleted"})
}

// Finish closes the session, deriving the real duration from the elapsed time.
func (h *WorkoutSessionHandler) Finish(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	workoutID, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout id"})
		return
	}
	var notes struct {
		Notes string `json:"notes"`
	}
	_ = json.NewDecoder(r.Body).Decode(&notes)

	workout, err := closeWorkout(r.Context(), h.db.Pool, workoutID, userID, notes.Notes)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "active workout not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to finish workout"})
		return
	}
	writeJSON(w, http.StatusOK, workout)
}

// Complete records a checklist in bulk and closes the session.
func (h *WorkoutSessionHandler) Complete(w http.ResponseWriter, r *http.Request) {
	h.applyChecklistRequest(w, r, true)
}

// Progress records a checklist but leaves the session open, so the guided mode
// can pick up from whatever was already ticked.
func (h *WorkoutSessionHandler) Progress(w http.ResponseWriter, r *http.Request) {
	h.applyChecklistRequest(w, r, false)
}

// applyChecklistRequest tops each exercise up to the number of series marked as
// done. It never rewrites series already logged with their real weight, and
// never exceeds the plan.
func (h *WorkoutSessionHandler) applyChecklistRequest(w http.ResponseWriter, r *http.Request, finish bool) {
	userID, _ := middleware.GetUserID(r.Context())
	workoutID, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout id"})
		return
	}
	var req models.CompleteWorkoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if !h.ownsActiveWorkout(r, userID, workoutID) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "active workout not found"})
		return
	}

	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save workout"})
		return
	}
	defer tx.Rollback(r.Context())

	for _, item := range req.Exercises {
		if item.SetsDone <= 0 {
			continue
		}
		if item.WeightKg < 0 || item.WeightKg > 1000 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid weight"})
			return
		}
		var name, trackingType string
		var plannedSets, reps int
		var duration *int
		err := tx.QueryRow(r.Context(),
			`SELECT e.exercise_name, e.sets, e.reps, e.tracking_type, e.duration_seconds
			 FROM training_plan_exercises e
			 JOIN workouts w ON w.training_plan_day_id = e.plan_day_id
			 WHERE e.id = $1 AND w.id = $2 FOR UPDATE OF e`,
			item.TrainingPlanExerciseID, workoutID,
		).Scan(&name, &plannedSets, &reps, &trackingType, &duration)
		if err == pgx.ErrNoRows {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "exercise does not belong to this workout"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save workout"})
			return
		}

		var alreadyDone int
		if err := tx.QueryRow(r.Context(),
			`SELECT COUNT(*) FROM workout_sets WHERE workout_id = $1 AND training_plan_exercise_id = $2`,
			workoutID, item.TrainingPlanExerciseID).Scan(&alreadyDone); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save workout"})
			return
		}
		target := item.SetsDone
		if target > plannedSets {
			target = plannedSets
		}
		recordedReps := reps
		if trackingType == "time" {
			recordedReps = 1
		}
		for setNumber := alreadyDone + 1; setNumber <= target; setNumber++ {
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO workout_sets (workout_id, exercise_name, sets, reps, weight_kg, tracking_type,
				 duration_seconds, training_plan_exercise_id, set_number, completed_at)
				 VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,NOW())`,
				workoutID, name, recordedReps, item.WeightKg, trackingType, duration,
				item.TrainingPlanExerciseID, setNumber); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save workout"})
				return
			}
		}
		if item.WeightKg > 0 {
			if _, err := tx.Exec(r.Context(),
				`UPDATE training_plan_exercises SET last_weight_kg = $2 WHERE id = $1`,
				item.TrainingPlanExerciseID, item.WeightKg); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save workout"})
				return
			}
		}
	}

	if !finish {
		if err := tx.Commit(r.Context()); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save workout"})
			return
		}
		h.writeActive(w, r, userID, workoutID)
		return
	}

	workout, err := closeWorkout(r.Context(), tx, workoutID, userID, req.Notes)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "active workout not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to complete workout"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to complete workout"})
		return
	}
	writeJSON(w, http.StatusOK, workout)
}

// closeWorkout marks the open session as completed. Shared by Finish and
// Complete so the duration is always derived the same way.
func closeWorkout(ctx context.Context, q queryRower, workoutID, userID int64, notes string) (models.Workout, error) {
	var workout models.Workout
	err := q.QueryRow(ctx,
		`UPDATE workouts SET status='completed', finished_at=NOW(), notes=$3,
		 duration_minutes=GREATEST(1, LEAST(600, ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, date))) / 60)::int))
		 WHERE id=$1 AND user_id=$2 AND status='in_progress'
		 RETURNING id, user_id, name, date, notes, training_plan_day_id, duration_minutes,
		 status, started_at, finished_at, client_session_id, created_at`,
		workoutID, userID, strings.TrimSpace(notes),
	).Scan(&workout.ID, &workout.UserID, &workout.Name, &workout.Date, &workout.Notes,
		&workout.TrainingPlanDayID, &workout.DurationMinutes, &workout.Status,
		&workout.StartedAt, &workout.FinishedAt, &workout.ClientSessionID, &workout.CreatedAt)
	return workout, err
}

// queryRower lets closeWorkout run either on the pool or inside a transaction.
type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Cancel discards an open session entirely, including the series already logged.
func (h *WorkoutSessionHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	workoutID, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout id"})
		return
	}
	result, err := h.db.Pool.Exec(r.Context(),
		`DELETE FROM workouts WHERE id=$1 AND user_id=$2 AND status='in_progress'`, workoutID, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to cancel workout"})
		return
	}
	if result.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "active workout not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "workout cancelled"})
}

func (h *WorkoutSessionHandler) ownsActiveWorkout(r *http.Request, userID, workoutID int64) bool {
	var exists bool
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM workouts WHERE id=$1 AND user_id=$2 AND status='in_progress')`,
		workoutID, userID).Scan(&exists)
	return err == nil && exists
}

func (h *WorkoutSessionHandler) writeActive(w http.ResponseWriter, r *http.Request, userID, workoutID int64) {
	var active models.ActiveWorkout
	var planDayID *int64
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT id, user_id, name, date, notes, training_plan_day_id, duration_minutes,
		 status, started_at, finished_at, client_session_id, created_at
		 FROM workouts WHERE id=$1 AND user_id=$2`, workoutID, userID,
	).Scan(&active.Workout.ID, &active.Workout.UserID, &active.Workout.Name, &active.Workout.Date,
		&active.Workout.Notes, &planDayID, &active.Workout.DurationMinutes, &active.Workout.Status,
		&active.Workout.StartedAt, &active.Workout.FinishedAt, &active.Workout.ClientSessionID,
		&active.Workout.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load workout"})
		return
	}
	active.Workout.TrainingPlanDayID = planDayID

	if planDayID != nil {
		var planID int64
		if err := h.db.Pool.QueryRow(r.Context(),
			`SELECT d.name, p.id FROM training_plan_days d JOIN training_plans p ON p.id = d.plan_id
			 WHERE d.id=$1`, *planDayID).Scan(&active.DayName, &planID); err == nil {
			active.PlanID = &planID
		}
		// Traz o vídeo demonstrativo junto: é nesta tela, com a pessoa prestes
		// a executar a série, que ele serve para alguma coisa. LEFT porque a
		// maioria dos nomes não tem vínculo e o exercício vale sem vídeo.
		rows, err := h.db.Pool.Query(r.Context(),
			`SELECT e.id, e.exercise_name, e.sets, e.reps, e.tracking_type, e.duration_seconds,
			        e.rest_seconds, e.notes, e.last_weight_kg,
			        v.catalog_name, v.object_webm, v.object_mp4
			 FROM training_plan_exercises e
			 LEFT JOIN exercise_video_links v ON v.exercise_name = e.exercise_name
			 WHERE e.plan_day_id=$1 ORDER BY e.exercise_order`, *planDayID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load exercises"})
			return
		}
		defer rows.Close()
		active.Exercises = []models.TrainingPlanExercise{}
		for rows.Next() {
			var exercise models.TrainingPlanExercise
			var catalogo, webm, mp4 *string
			if err := rows.Scan(&exercise.ID, &exercise.ExerciseName, &exercise.Sets, &exercise.Reps,
				&exercise.TrackingType, &exercise.DurationSeconds, &exercise.RestSeconds,
				&exercise.Notes, &exercise.LastWeightKg, &catalogo, &webm, &mp4); err == nil {
				exercise.Video = montarVideo(catalogo, webm, mp4)
				active.Exercises = append(active.Exercises, exercise)
			}
		}
	}
	if active.Exercises == nil {
		active.Exercises = []models.TrainingPlanExercise{}
	}

	setRows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, workout_id, exercise_name, sets, reps, tracking_type, duration_seconds,
		 weight_kg, training_plan_exercise_id, set_number, client_set_id, completed_at, created_at
		 FROM workout_sets WHERE workout_id=$1 ORDER BY id`, workoutID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load sets"})
		return
	}
	defer setRows.Close()
	active.Workout.Sets = []models.WorkoutSet{}
	for setRows.Next() {
		var set models.WorkoutSet
		if err := setRows.Scan(&set.ID, &set.WorkoutID, &set.ExerciseName, &set.Sets, &set.Reps,
			&set.TrackingType, &set.DurationSeconds, &set.WeightKg, &set.TrainingPlanExerciseID,
			&set.SetNumber, &set.ClientSetID, &set.CompletedAt, &set.CreatedAt); err == nil {
			active.Workout.Sets = append(active.Workout.Sets, set)
		}
	}
	writeJSON(w, http.StatusOK, active)
}

// GetSettings returns the guided session preferences, falling back to defaults
// when the profile has not been created yet.
func (h *WorkoutSessionHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	settings := models.TrainingSettings{CountdownSeconds: 5, VibrationEnabled: true}
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT countdown_seconds, vibration_enabled, auto_advance FROM user_profiles WHERE user_id=$1`, userID,
	).Scan(&settings.CountdownSeconds, &settings.VibrationEnabled, &settings.AutoAdvance)
	if err != nil && err != pgx.ErrNoRows {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load settings"})
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (h *WorkoutSessionHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var settings models.TrainingSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if settings.CountdownSeconds < 0 || settings.CountdownSeconds > 60 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "countdown_seconds must be between 0 and 60"})
		return
	}
	result, err := h.db.Pool.Exec(r.Context(),
		`UPDATE user_profiles SET countdown_seconds=$2, vibration_enabled=$3, auto_advance=$4, updated_at=NOW()
		 WHERE user_id=$1`, userID, settings.CountdownSeconds, settings.VibrationEnabled, settings.AutoAdvance)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save settings"})
		return
	}
	if result.RowsAffected() == 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "complete the profile first"})
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// parseWorkoutIDFromSessionPath reads the id from /api/workouts/{id}/<action>.
func parseWorkoutIDFromSessionPath(path string) (int64, error) {
	parts := strings.Split(strings.TrimRight(path, "/"), "/")
	if len(parts) < 2 {
		return 0, strconv.ErrSyntax
	}
	return strconv.ParseInt(parts[len(parts)-2], 10, 64)
}
