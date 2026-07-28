package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

// Adjust rewrites a plan from a free-text request. It runs in background like
// the automatic creation, reusing training_plan_jobs so the screen polls the
// same endpoint.
func (h *TrainingPlanHandler) Adjust(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	planID, err := parsePlanIDFromAdjustPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid training plan id"})
		return
	}
	var req struct {
		Instructions string `json:"instructions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.Instructions = strings.TrimSpace(req.Instructions)
	if req.Instructions == "" || len(req.Instructions) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "descreva o ajuste em até 2000 caracteres"})
		return
	}

	current, err := h.loadPlanInput(r.Context(), planID, userID)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "training plan not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load training plan"})
		return
	}
	userContext, err := h.buildUserContext(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare training context"})
		return
	}

	var job models.TrainingPlanJob
	err = h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO training_plan_jobs (user_id, status, plan_id) VALUES ($1,'pending',$2)
		 RETURNING id, status, plan_id, error, created_at`, userID, planID,
	).Scan(&job.ID, &job.Status, &job.PlanID, &job.Error, &job.CreatedAt)
	if err != nil {
		slog.Error("failed to create adjust job", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to start adjustment"})
		return
	}
	go h.runAdjust(job.ID, userID, planID, userContext, *current, req.Instructions)
	writeJSON(w, http.StatusAccepted, job)
}

func (h *TrainingPlanHandler) runAdjust(jobID, userID, planID int64, userContext string, current models.TrainingPlanInput, instructions string) {
	ctx, cancel := context.WithTimeout(context.Background(), automaticPlanTimeout)
	defer cancel()

	fail := func(message string, err error) {
		slog.Error(message, "user_id", userID, "job_id", jobID, "error", err)
		if _, updateErr := h.db.Pool.Exec(context.Background(),
			`UPDATE training_plan_jobs SET status='failed', error=$2, updated_at=NOW() WHERE id=$1`,
			jobID, message); updateErr != nil {
			slog.Error("failed to mark adjust job as failed", "job_id", jobID, "error", updateErr)
		}
	}

	adjusted, err := h.assistant.Adjust(ctx, userContext, current, instructions)
	if err != nil {
		fail("the training plan assistant is temporarily unavailable", err)
		return
	}
	if err := h.applyAdjustment(ctx, planID, *adjusted); err != nil {
		fail("failed to save the adjusted plan", err)
		return
	}
	if _, err := h.db.Pool.Exec(context.Background(),
		`UPDATE training_plan_jobs SET status='done', updated_at=NOW() WHERE id=$1`, jobID); err != nil {
		slog.Error("failed to mark adjust job as done", "job_id", jobID, "error", err)
	}
}

func (h *TrainingPlanHandler) loadPlanInput(ctx context.Context, planID, userID int64) (*models.TrainingPlanInput, error) {
	var input models.TrainingPlanInput
	var targetDate time.Time
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT name, description, target_date, days_per_week, session_duration_minutes
		 FROM training_plans WHERE id = $1 AND user_id = $2`, planID, userID,
	).Scan(&input.Name, &input.Description, &targetDate, &input.DaysPerWeek, &input.SessionDurationMinutes); err != nil {
		return nil, err
	}
	input.TargetDate = targetDate.Format("2006-01-02")

	dayRows, err := h.db.Pool.Query(ctx,
		`SELECT id, name, focus, instructions FROM training_plan_days
		 WHERE plan_id = $1 ORDER BY day_number`, planID)
	if err != nil {
		return nil, err
	}
	type dayRef struct {
		id  int64
		day models.TrainingPlanDayInput
	}
	var days []dayRef
	for dayRows.Next() {
		var ref dayRef
		if err := dayRows.Scan(&ref.id, &ref.day.Name, &ref.day.Focus, &ref.day.Instructions); err == nil {
			days = append(days, ref)
		}
	}
	dayRows.Close()

	for i := range days {
		exerciseRows, err := h.db.Pool.Query(ctx,
			`SELECT exercise_name, sets, reps, tracking_type, duration_seconds, rest_seconds, notes
			 FROM training_plan_exercises WHERE plan_day_id = $1 ORDER BY exercise_order`, days[i].id)
		if err != nil {
			return nil, err
		}
		for exerciseRows.Next() {
			var exercise models.TrainingPlanExerciseInput
			if err := exerciseRows.Scan(&exercise.ExerciseName, &exercise.Sets, &exercise.Reps,
				&exercise.TrackingType, &exercise.DurationSeconds, &exercise.RestSeconds, &exercise.Notes); err == nil {
				days[i].day.Exercises = append(days[i].day.Exercises, exercise)
			}
		}
		exerciseRows.Close()
		input.Days = append(input.Days, days[i].day)
	}
	return &input, nil
}

// applyAdjustment reconciles the plan in place instead of recreating it.
// training_plan_days and training_plan_exercises are referenced by workouts and
// workout_sets with ON DELETE SET NULL, so dropping and reinserting them would
// silently unlink every past workout from its plan day and every logged series
// from its exercise — losing "última vez" and the remembered weights.
func (h *TrainingPlanHandler) applyAdjustment(ctx context.Context, planID int64, plan models.TrainingPlanInput) error {
	if err := validatePlanBasics(plan.TargetDate, len(plan.Days), plan.SessionDurationMinutes); err != nil {
		return err
	}
	tx, err := h.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`UPDATE training_plans SET name=$2, description=$3, days_per_week=$4, updated_at=NOW() WHERE id=$1`,
		planID, strings.TrimSpace(plan.Name), strings.TrimSpace(plan.Description), len(plan.Days)); err != nil {
		return err
	}

	existingDays := map[int]int64{}
	rows, err := tx.Query(ctx, `SELECT day_number, id FROM training_plan_days WHERE plan_id=$1`, planID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var number int
		var id int64
		if err := rows.Scan(&number, &id); err == nil {
			existingDays[number] = id
		}
	}
	rows.Close()

	for index, day := range plan.Days {
		dayNumber := index + 1
		if strings.TrimSpace(day.Name) == "" || len(day.Exercises) == 0 || len(day.Exercises) > 12 {
			return fmt.Errorf("dia %d inválido no plano ajustado", dayNumber)
		}
		dayID, exists := existingDays[dayNumber]
		if exists {
			if _, err := tx.Exec(ctx,
				`UPDATE training_plan_days SET name=$2, focus=$3, instructions=$4 WHERE id=$1`,
				dayID, strings.TrimSpace(day.Name), strings.TrimSpace(day.Focus), strings.TrimSpace(day.Instructions)); err != nil {
				return err
			}
			delete(existingDays, dayNumber)
		} else {
			if err := tx.QueryRow(ctx,
				`INSERT INTO training_plan_days (plan_id, day_number, name, focus, instructions)
				 VALUES ($1,$2,$3,$4,$5) RETURNING id`,
				planID, dayNumber, strings.TrimSpace(day.Name), strings.TrimSpace(day.Focus),
				strings.TrimSpace(day.Instructions)).Scan(&dayID); err != nil {
				return err
			}
		}
		if err := applyDayExercises(ctx, tx, dayID, day.Exercises); err != nil {
			return err
		}
	}

	// Days beyond the new count no longer exist in the plan.
	for _, id := range existingDays {
		if _, err := tx.Exec(ctx, `DELETE FROM training_plan_days WHERE id=$1`, id); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func applyDayExercises(ctx context.Context, tx pgx.Tx, dayID int64, exercises []models.TrainingPlanExerciseInput) error {
	type existing struct {
		id   int64
		name string
	}
	current := map[int]existing{}
	rows, err := tx.Query(ctx,
		`SELECT exercise_order, id, exercise_name FROM training_plan_exercises WHERE plan_day_id=$1`, dayID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var order int
		var item existing
		if err := rows.Scan(&order, &item.id, &item.name); err == nil {
			current[order] = item
		}
	}
	rows.Close()

	for index, exercise := range exercises {
		order := index + 1
		if exercise.TrackingType == "" {
			exercise.TrackingType = "reps"
		}
		if strings.TrimSpace(exercise.ExerciseName) == "" || exercise.Sets < 1 || exercise.Sets > 20 ||
			exercise.Reps < 1 || exercise.Reps > 100 || exercise.RestSeconds < 0 || exercise.RestSeconds > 600 ||
			(exercise.TrackingType != "reps" && exercise.TrackingType != "time") ||
			(exercise.TrackingType == "time" && (exercise.DurationSeconds == nil || *exercise.DurationSeconds < 1 || *exercise.DurationSeconds > 7200)) {
			return fmt.Errorf("exercício inválido na posição %d", order)
		}
		name := strings.TrimSpace(exercise.ExerciseName)
		if slot, ok := current[order]; ok {
			// Updating in place keeps the id, and with it the link to every
			// series already logged. The remembered weight only survives when
			// the movement itself did — a different exercise makes it misleading.
			query := `UPDATE training_plan_exercises
			          SET exercise_name=$2, sets=$3, reps=$4, tracking_type=$5,
			              duration_seconds=$6, rest_seconds=$7, notes=$8`
			if !strings.EqualFold(slot.name, name) {
				query += `, last_weight_kg=NULL`
			}
			query += ` WHERE id=$1`
			if _, err := tx.Exec(ctx, query, slot.id, name, exercise.Sets, exercise.Reps,
				exercise.TrackingType, exercise.DurationSeconds, exercise.RestSeconds,
				strings.TrimSpace(exercise.Notes)); err != nil {
				return err
			}
			delete(current, order)
			continue
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO training_plan_exercises (plan_day_id, exercise_order, exercise_name, sets, reps,
			 tracking_type, duration_seconds, rest_seconds, notes)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			dayID, order, name, exercise.Sets, exercise.Reps, exercise.TrackingType,
			exercise.DurationSeconds, exercise.RestSeconds, strings.TrimSpace(exercise.Notes)); err != nil {
			return err
		}
	}

	for _, slot := range current {
		if _, err := tx.Exec(ctx, `DELETE FROM training_plan_exercises WHERE id=$1`, slot.id); err != nil {
			return err
		}
	}
	return nil
}

// parsePlanIDFromAdjustPath reads the id from /api/training-plans/{id}/adjust.
func parsePlanIDFromAdjustPath(path string) (int64, error) {
	return parseWorkoutIDFromSessionPath(path)
}
