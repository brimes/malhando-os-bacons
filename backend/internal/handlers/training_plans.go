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
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

// automaticPlanTimeout bounds a background generation. The assistant regularly
// needs several minutes for a full multi-day plan, so this is generous on
// purpose — it only exists to keep a stuck job from hanging forever.
const automaticPlanTimeout = 15 * time.Minute

type TrainingPlanHandler struct {
	db        *db.DB
	assistant services.TrainingPlanAssistant
}

func NewTrainingPlanHandler(database *db.DB, assistant services.TrainingPlanAssistant) *TrainingPlanHandler {
	return &TrainingPlanHandler{db: database, assistant: assistant}
}

func (h *TrainingPlanHandler) List(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, name, description, target_date, days_per_week, session_duration_minutes,
		 creation_method, adaptation_phase, active, created_at
		 FROM training_plans WHERE user_id = $1 ORDER BY active DESC, created_at DESC`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load training plans"})
		return
	}
	defer rows.Close()
	plans := []models.TrainingPlan{}
	for rows.Next() {
		var plan models.TrainingPlan
		if err := rows.Scan(&plan.ID, &plan.Name, &plan.Description, &plan.TargetDate, &plan.DaysPerWeek,
			&plan.SessionDurationMinutes, &plan.CreationMethod, &plan.AdaptationPhase, &plan.Active, &plan.CreatedAt); err == nil {
			plans = append(plans, plan)
		}
	}
	writeJSON(w, http.StatusOK, plans)
}

func (h *TrainingPlanHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid training plan id"})
		return
	}
	var plan models.TrainingPlan
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT id, name, description, target_date, days_per_week, session_duration_minutes,
		 creation_method, adaptation_phase, active, created_at
		 FROM training_plans WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&plan.ID, &plan.Name, &plan.Description, &plan.TargetDate, &plan.DaysPerWeek,
		&plan.SessionDurationMinutes, &plan.CreationMethod, &plan.AdaptationPhase, &plan.Active, &plan.CreatedAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "training plan not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load training plan"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT d.id, d.day_number, d.name, d.focus, d.instructions, MAX(w.date)
		 FROM training_plan_days d LEFT JOIN workouts w ON w.training_plan_day_id = d.id AND w.status = 'completed'
		 WHERE d.plan_id = $1 GROUP BY d.id ORDER BY d.day_number`, plan.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load plan days"})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var day models.TrainingPlanDay
		if err := rows.Scan(&day.ID, &day.DayNumber, &day.Name, &day.Focus, &day.Instructions, &day.LastDoneAt); err != nil {
			continue
		}
		exerciseRows, err := h.db.Pool.Query(r.Context(),
			`SELECT id, exercise_name, sets, reps, tracking_type, duration_seconds, rest_seconds, notes, last_weight_kg
			 FROM training_plan_exercises WHERE plan_day_id = $1 ORDER BY exercise_order`, day.ID)
		if err != nil {
			continue
		}
		day.Exercises = []models.TrainingPlanExercise{}
		for exerciseRows.Next() {
			var exercise models.TrainingPlanExercise
			if err := exerciseRows.Scan(&exercise.ID, &exercise.ExerciseName, &exercise.Sets, &exercise.Reps,
				&exercise.TrackingType, &exercise.DurationSeconds, &exercise.RestSeconds, &exercise.Notes,
				&exercise.LastWeightKg); err == nil {
				day.Exercises = append(day.Exercises, exercise)
			}
		}
		exerciseRows.Close()
		plan.Days = append(plan.Days, day)
	}
	writeJSON(w, http.StatusOK, plan)
}

func (h *TrainingPlanHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid training plan id"})
		return
	}
	result, err := h.db.Pool.Exec(r.Context(), `DELETE FROM training_plans WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete training plan"})
		return
	}
	if result.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "training plan not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "training plan deleted"})
}

func (h *TrainingPlanHandler) CreateManual(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var input models.TrainingPlanInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	plan, err := h.create(r.Context(), userID, input, "manual")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, plan)
}

// CreateAutomatic enqueues the generation and returns immediately: the assistant
// routinely takes several minutes, far more than a request can be held open.
func (h *TrainingPlanHandler) CreateAutomatic(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.AutomaticTrainingPlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if err := validatePlanBasics(req.TargetDate, req.DaysPerWeek, req.SessionDurationMinutes); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	userContext, err := h.buildUserContext(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare training context"})
		return
	}
	var job models.TrainingPlanJob
	err = h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO training_plan_jobs (user_id, status) VALUES ($1,'pending')
		 RETURNING id, status, plan_id, error, created_at`, userID,
	).Scan(&job.ID, &job.Status, &job.PlanID, &job.Error, &job.CreatedAt)
	if err != nil {
		slog.Error("failed to create training plan job", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to start plan generation"})
		return
	}
	go h.runAutomatic(job.ID, userID, userContext, req)
	writeJSON(w, http.StatusAccepted, job)
}

// runAutomatic executes the generation detached from the request, using its own
// context so a disconnected client never aborts an in-flight plan.
func (h *TrainingPlanHandler) runAutomatic(jobID, userID int64, userContext string, req models.AutomaticTrainingPlanRequest) {
	ctx, cancel := context.WithTimeout(context.Background(), automaticPlanTimeout)
	defer cancel()

	fail := func(message string, err error) {
		slog.Error(message, "user_id", userID, "job_id", jobID, "error", err)
		if _, updateErr := h.db.Pool.Exec(context.Background(),
			`UPDATE training_plan_jobs SET status='failed', error=$2, updated_at=NOW() WHERE id=$1`,
			jobID, message); updateErr != nil {
			slog.Error("failed to mark training plan job as failed", "job_id", jobID, "error", updateErr)
		}
	}

	input, err := h.assistant.Generate(ctx, userContext, req)
	if err != nil {
		fail("the training plan assistant is temporarily unavailable", err)
		return
	}
	plan, err := h.create(ctx, userID, *input, "automatic")
	if err != nil {
		fail("failed to save generated training plan", err)
		return
	}
	if _, err := h.db.Pool.Exec(context.Background(),
		`UPDATE training_plan_jobs SET status='done', plan_id=$2, updated_at=NOW() WHERE id=$1`,
		jobID, plan.ID); err != nil {
		slog.Error("failed to mark training plan job as done", "job_id", jobID, "error", err)
	}
}

func (h *TrainingPlanHandler) GetJob(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid job id"})
		return
	}
	var job models.TrainingPlanJob
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT id, status, plan_id, error, created_at FROM training_plan_jobs
		 WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&job.ID, &job.Status, &job.PlanID, &job.Error, &job.CreatedAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "job not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load job"})
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (h *TrainingPlanHandler) create(ctx context.Context, userID int64, input models.TrainingPlanInput, method string) (*models.TrainingPlan, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 120 {
		return nil, fmt.Errorf("plan name is required")
	}
	if err := validatePlanBasics(input.TargetDate, input.DaysPerWeek, input.SessionDurationMinutes); err != nil {
		return nil, err
	}
	if len(input.Days) != input.DaysPerWeek {
		return nil, fmt.Errorf("the number of plan days must match days_per_week")
	}
	targetDate, _ := time.Parse("2006-01-02", input.TargetDate)
	var adaptation bool
	_ = h.db.Pool.QueryRow(ctx,
		`SELECT training_experience = 'beginner' AND adaptation_ends_at >= CURRENT_DATE
		 FROM user_profiles WHERE user_id = $1`, userID).Scan(&adaptation)
	tx, err := h.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var plan models.TrainingPlan
	err = tx.QueryRow(ctx,
		`INSERT INTO training_plans (user_id, name, description, target_date, days_per_week,
		 session_duration_minutes, creation_method, adaptation_phase)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		 RETURNING id,name,description,target_date,days_per_week,session_duration_minutes,
		 creation_method,adaptation_phase,active,created_at`,
		userID, input.Name, strings.TrimSpace(input.Description), targetDate, input.DaysPerWeek,
		input.SessionDurationMinutes, method, adaptation,
	).Scan(&plan.ID, &plan.Name, &plan.Description, &plan.TargetDate, &plan.DaysPerWeek,
		&plan.SessionDurationMinutes, &plan.CreationMethod, &plan.AdaptationPhase, &plan.Active, &plan.CreatedAt)
	if err != nil {
		return nil, err
	}
	for dayIndex, dayInput := range input.Days {
		if strings.TrimSpace(dayInput.Name) == "" || len(dayInput.Exercises) == 0 || len(dayInput.Exercises) > 12 {
			return nil, fmt.Errorf("each day needs a name and exercises")
		}
		var day models.TrainingPlanDay
		err = tx.QueryRow(ctx,
			`INSERT INTO training_plan_days (plan_id,day_number,name,focus,instructions)
			 VALUES ($1,$2,$3,$4,$5) RETURNING id,day_number,name,focus,instructions`,
			plan.ID, dayIndex+1, strings.TrimSpace(dayInput.Name), strings.TrimSpace(dayInput.Focus), strings.TrimSpace(dayInput.Instructions),
		).Scan(&day.ID, &day.DayNumber, &day.Name, &day.Focus, &day.Instructions)
		if err != nil {
			return nil, err
		}
		for exerciseIndex, exerciseInput := range dayInput.Exercises {
			if exerciseInput.TrackingType == "" {
				exerciseInput.TrackingType = "reps"
			}
			if strings.TrimSpace(exerciseInput.ExerciseName) == "" || exerciseInput.Sets < 1 || exerciseInput.Sets > 20 ||
				exerciseInput.Reps < 1 || exerciseInput.Reps > 100 || exerciseInput.RestSeconds < 0 || exerciseInput.RestSeconds > 600 ||
				(exerciseInput.TrackingType != "reps" && exerciseInput.TrackingType != "time") ||
				(exerciseInput.TrackingType == "time" && (exerciseInput.DurationSeconds == nil || *exerciseInput.DurationSeconds < 1 || *exerciseInput.DurationSeconds > 7200)) {
				return nil, fmt.Errorf("invalid exercise in day %d", dayIndex+1)
			}
			var exercise models.TrainingPlanExercise
			err = tx.QueryRow(ctx,
				`INSERT INTO training_plan_exercises (plan_day_id,exercise_order,exercise_name,sets,reps,tracking_type,duration_seconds,rest_seconds,notes)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
				 RETURNING id,exercise_name,sets,reps,tracking_type,duration_seconds,rest_seconds,notes`,
				day.ID, exerciseIndex+1, strings.TrimSpace(exerciseInput.ExerciseName), exerciseInput.Sets,
				exerciseInput.Reps, exerciseInput.TrackingType, exerciseInput.DurationSeconds,
				exerciseInput.RestSeconds, strings.TrimSpace(exerciseInput.Notes),
			).Scan(&exercise.ID, &exercise.ExerciseName, &exercise.Sets, &exercise.Reps,
				&exercise.TrackingType, &exercise.DurationSeconds, &exercise.RestSeconds, &exercise.Notes)
			if err != nil {
				return nil, err
			}
			day.Exercises = append(day.Exercises, exercise)
		}
		plan.Days = append(plan.Days, day)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &plan, nil
}

func validatePlanBasics(targetDate string, daysPerWeek, duration int) error {
	date, err := time.Parse("2006-01-02", targetDate)
	if err != nil || !date.After(time.Now().Truncate(24*time.Hour)) {
		return fmt.Errorf("target_date must be a future date")
	}
	if daysPerWeek < 1 || daysPerWeek > 7 {
		return fmt.Errorf("days_per_week must be between 1 and 7")
	}
	if duration < 10 || duration > 240 {
		return fmt.Errorf("session_duration_minutes must be between 10 and 240")
	}
	return nil
}

func (h *TrainingPlanHandler) buildUserContext(ctx context.Context, userID int64) (string, error) {
	var birthDate time.Time
	var height, weight float64
	var sex, injuries, experience *string
	var adaptation *time.Time
	err := h.db.Pool.QueryRow(ctx,
		`SELECT birth_date,height_cm,current_weight_kg,biological_sex,injuries_or_limitations,
		 training_experience,adaptation_ends_at FROM user_profiles WHERE user_id=$1`, userID,
	).Scan(&birthDate, &height, &weight, &sex, &injuries, &experience, &adaptation)
	if err != nil {
		return "", err
	}
	summary := fmt.Sprintf("Perfil: nascimento=%s, altura=%.1fcm, peso=%.1fkg, sexo=%v, experiência=%v, adaptação até=%v, lesões/limitações=%v. ",
		birthDate.Format("2006-01-02"), height, weight, pointerValue(sex), pointerValue(experience), timePointerValue(adaptation), pointerValue(injuries))
	var goalSummary string
	_ = h.db.Pool.QueryRow(ctx, `SELECT summary FROM user_goals WHERE user_id=$1`, userID).Scan(&goalSummary)
	summary += "Objetivo: " + goalSummary + ". Histórico recente: "
	var fitnessDistance, fitnessExertion int
	if h.db.Pool.QueryRow(ctx,
		`SELECT distance_meters, perceived_exertion FROM fitness_assessments
		 WHERE user_id=$1 ORDER BY performed_at DESC LIMIT 1`, userID,
	).Scan(&fitnessDistance, &fitnessExertion) == nil {
		summary += fmt.Sprintf("Última caminhada de 6 minutos: %dm, esforço %d/10. ", fitnessDistance, fitnessExertion)
	}
	rows, err := h.db.Pool.Query(ctx,
		`SELECT w.date::date,w.name,COALESCE(w.duration_minutes,0),
		 COALESCE(string_agg(ws.exercise_name || ' ' || ws.sets || 'x' || ws.reps, ', ' ORDER BY ws.id),'')
		 FROM workouts w LEFT JOIN workout_sets ws ON ws.workout_id=w.id
		 WHERE w.user_id=$1 AND w.status='completed' GROUP BY w.id ORDER BY w.date DESC LIMIT 30`, userID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	for rows.Next() {
		var date time.Time
		var name, exercises string
		var duration int
		if rows.Scan(&date, &name, &duration, &exercises) == nil {
			summary += fmt.Sprintf("[%s %s %dmin: %s] ", date.Format("2006-01-02"), name, duration, exercises)
		}
	}
	return summary, nil
}

func pointerValue(value *string) string {
	if value == nil {
		return "não informado"
	}
	return *value
}

func timePointerValue(value *time.Time) string {
	if value == nil {
		return "não se aplica"
	}
	return value.Format("2006-01-02")
}
