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
)

// CreateDynamic cria um plano kind='dynamic': só a configuração, sem dias.
// Diferente de CreateAutomatic, não passa pelo assistente nem por job — não há
// o que gerar ainda, o primeiro dia só nasce quando a pessoa pedir um treino
// pelo GenerateDynamicDay.
func (h *TrainingPlanHandler) CreateDynamic(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.DynamicTrainingPlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 120 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "plan name is required"})
		return
	}
	if err := validatePlanBasics(req.TargetDate, req.DaysPerWeek, req.SessionDurationMinutes); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := validateGymOwnership(r.Context(), h.db, userID, req.GymID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	targetDate, _ := time.Parse("2006-01-02", req.TargetDate)

	var plan models.TrainingPlan
	err := h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO training_plans (user_id, name, description, target_date, days_per_week,
		 session_duration_minutes, creation_method, kind, gym_id, preferences)
		 VALUES ($1,$2,'',$3,$4,$5,'automatic','dynamic',$6,$7)
		 RETURNING id, name, description, target_date, days_per_week, session_duration_minutes,
		 creation_method, adaptation_phase, active, kind, gym_id, preferences, created_at`,
		userID, req.Name, targetDate, req.DaysPerWeek, req.SessionDurationMinutes,
		req.GymID, strings.TrimSpace(req.Preferences),
	).Scan(&plan.ID, &plan.Name, &plan.Description, &plan.TargetDate, &plan.DaysPerWeek,
		&plan.SessionDurationMinutes, &plan.CreationMethod, &plan.AdaptationPhase, &plan.Active,
		&plan.Kind, &plan.GymID, &plan.Preferences, &plan.CreatedAt)
	if err != nil {
		slog.Error("failed to create dynamic training plan", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create training plan"})
		return
	}
	plan.Days = []models.TrainingPlanDay{}
	writeJSON(w, http.StatusCreated, plan)
}

// GenerateDynamicDay pede um dia novo para um plano dinâmico. Mesmo padrão
// assíncrono de CreateAutomatic (insere o job, dispara a goroutine desacoplada
// da requisição, responde 202) pelo mesmo motivo: o assistente leva minutos.
func (h *TrainingPlanHandler) GenerateDynamicDay(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	planID, err := parsePlanIDFromAdjustPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid training plan id"})
		return
	}

	var plan models.TrainingPlan
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT id, name, days_per_week, session_duration_minutes, kind, gym_id, preferences
		 FROM training_plans WHERE id = $1 AND user_id = $2`, planID, userID,
	).Scan(&plan.ID, &plan.Name, &plan.DaysPerWeek, &plan.SessionDurationMinutes, &plan.Kind, &plan.GymID, &plan.Preferences)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "training plan not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load training plan"})
		return
	}
	if plan.Kind != "dynamic" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "plan is not dynamic"})
		return
	}

	userContext, err := buildUserContext(r.Context(), h.db, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare training context"})
		return
	}
	gymContext, err := buildGymContext(r.Context(), h.db, userID, plan.GymID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare training context"})
		return
	}
	recent, err := buildDynamicPlanRecent(r.Context(), h.db, planID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare training context"})
		return
	}
	userContext += gymContext

	var job models.TrainingPlanJob
	err = h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO training_plan_jobs (user_id, status, plan_id) VALUES ($1,'pending',$2)
		 RETURNING id, status, plan_id, plan_day_id, error, created_at`, userID, planID,
	).Scan(&job.ID, &job.Status, &job.PlanID, &job.PlanDayID, &job.Error, &job.CreatedAt)
	if err != nil {
		slog.Error("failed to create dynamic day job", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to start day generation"})
		return
	}
	go h.runDynamicDay(job.ID, userID, planID, userContext, plan, recent)
	writeJSON(w, http.StatusAccepted, job)
}

// runDynamicDay executa a geração desacoplada da requisição, com seu próprio
// contexto — mesma razão de runAutomatic: o cliente pode desconectar bem antes
// de o assistente responder.
func (h *TrainingPlanHandler) runDynamicDay(jobID, userID, planID int64, userContext string, plan models.TrainingPlan, recent string) {
	ctx, cancel := context.WithTimeout(context.Background(), automaticPlanTimeout)
	defer cancel()

	fail := func(message string, err error) {
		slog.Error(message, "user_id", userID, "job_id", jobID, "error", err)
		if _, updateErr := h.db.Pool.Exec(context.Background(),
			`UPDATE training_plan_jobs SET status='failed', error=$2, updated_at=NOW() WHERE id=$1`,
			jobID, message); updateErr != nil {
			slog.Error("failed to mark dynamic day job as failed", "job_id", jobID, "error", updateErr)
		}
	}

	dayInput, err := h.assistantFor(ctx, userID).GenerateDynamicDay(ctx, userContext, plan, recent)
	if err != nil {
		fail("the training plan assistant is temporarily unavailable", err)
		return
	}
	day, err := h.insertDynamicDay(ctx, planID, *dayInput)
	if err != nil {
		fail("failed to save generated day", err)
		return
	}
	if _, err := h.db.Pool.Exec(context.Background(),
		`UPDATE training_plan_jobs SET status='done', plan_day_id=$2, updated_at=NOW() WHERE id=$1`,
		jobID, day.ID); err != nil {
		slog.Error("failed to mark dynamic day job as done", "job_id", jobID, "error", err)
	}
	// Mesmo tratamento de create(): associação de vídeo em segundo plano, sem
	// segurar o job por isso. Empacota um plano avulso só com o dia novo —
	// associarVideosEmSegundoPlano só olha plan.Days para montar a lista de nomes.
	h.associarVideosEmSegundoPlano(userID, &models.TrainingPlan{ID: planID, Days: []models.TrainingPlanDay{*day}})
}

// insertDynamicDay grava o dia novo do plano dinâmico. Nunca apaga nem
// reaproveita um dia anterior: day_number sempre avança a partir do maior já
// existente, então o histórico de treinos e séries dos dias antigos
// (workouts.training_plan_day_id, workout_sets.training_plan_exercise_id)
// nunca é tocado.
func (h *TrainingPlanHandler) insertDynamicDay(ctx context.Context, planID int64, input models.TrainingPlanDayInput) (*models.TrainingPlanDay, error) {
	if strings.TrimSpace(input.Name) == "" || len(input.Exercises) == 0 || len(input.Exercises) > 12 {
		return nil, fmt.Errorf("generated day is invalid")
	}
	tx, err := h.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Trava a linha do plano antes de contar. Duas gerações simultâneas — dois
	// toques, ou dois aparelhos — leriam o mesmo MAX e a segunda esbarraria no
	// UNIQUE(plan_id, day_number), jogando fora um treino que o assistente já
	// tinha levado minutos para montar.
	if _, err := tx.Exec(ctx, `SELECT id FROM training_plans WHERE id = $1 FOR UPDATE`, planID); err != nil {
		return nil, err
	}

	var dayNumber int
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(MAX(day_number),0)+1 FROM training_plan_days WHERE plan_id = $1`, planID).Scan(&dayNumber); err != nil {
		return nil, err
	}

	var day models.TrainingPlanDay
	if err := tx.QueryRow(ctx,
		`INSERT INTO training_plan_days (plan_id, day_number, name, focus, instructions, generated_for, generated_at)
		 VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,NOW())
		 RETURNING id, day_number, name, focus, instructions, generated_for, generated_at`,
		planID, dayNumber, strings.TrimSpace(input.Name), strings.TrimSpace(input.Focus), strings.TrimSpace(input.Instructions),
	).Scan(&day.ID, &day.DayNumber, &day.Name, &day.Focus, &day.Instructions, &day.GeneratedFor, &day.GeneratedAt); err != nil {
		return nil, err
	}

	for exerciseIndex, exerciseInput := range input.Exercises {
		if exerciseInput.TrackingType == "" {
			exerciseInput.TrackingType = "reps"
		}
		if strings.TrimSpace(exerciseInput.ExerciseName) == "" || exerciseInput.Sets < 1 || exerciseInput.Sets > 20 ||
			exerciseInput.Reps < 1 || exerciseInput.Reps > 100 || exerciseInput.RestSeconds < 0 || exerciseInput.RestSeconds > 600 ||
			(exerciseInput.TrackingType != "reps" && exerciseInput.TrackingType != "time") ||
			(exerciseInput.TrackingType == "time" && (exerciseInput.DurationSeconds == nil || *exerciseInput.DurationSeconds < 1 || *exerciseInput.DurationSeconds > 7200)) {
			return nil, fmt.Errorf("invalid exercise in generated day")
		}
		var exercise models.TrainingPlanExercise
		if err := tx.QueryRow(ctx,
			`INSERT INTO training_plan_exercises (plan_day_id,exercise_order,exercise_name,sets,reps,tracking_type,duration_seconds,rest_seconds,notes)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			 RETURNING id,exercise_name,sets,reps,tracking_type,duration_seconds,rest_seconds,notes`,
			day.ID, exerciseIndex+1, strings.TrimSpace(exerciseInput.ExerciseName), exerciseInput.Sets,
			exerciseInput.Reps, exerciseInput.TrackingType, exerciseInput.DurationSeconds,
			exerciseInput.RestSeconds, strings.TrimSpace(exerciseInput.Notes),
		).Scan(&exercise.ID, &exercise.ExerciseName, &exercise.Sets, &exercise.Reps,
			&exercise.TrackingType, &exercise.DurationSeconds, &exercise.RestSeconds, &exercise.Notes); err != nil {
			return nil, err
		}
		day.Exercises = append(day.Exercises, exercise)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &day, nil
}

// buildDynamicPlanRecent resume os últimos 10 dias já gerados deste plano
// (nome, foco e exercícios) e os treinos concluídos recentes contra eles, para
// o assistente evitar repetir o grupo muscular do último treino. Escopado a
// este plano de propósito: o histórico geral da pessoa (qualquer plano) já
// está em buildUserContext — aqui entra só o que é específico deste plano
// dinâmico.
func buildDynamicPlanRecent(ctx context.Context, database *db.DB, planID int64) (string, error) {
	var summary strings.Builder

	summary.WriteString("Últimos dias já gerados deste plano dinâmico: ")
	dayRows, err := database.Pool.Query(ctx,
		`SELECT d.name, d.focus, COALESCE(string_agg(e.exercise_name, ', ' ORDER BY e.exercise_order), '')
		 FROM training_plan_days d LEFT JOIN training_plan_exercises e ON e.plan_day_id = d.id
		 WHERE d.plan_id = $1 GROUP BY d.id ORDER BY d.day_number DESC LIMIT 10`, planID)
	if err != nil {
		return "", err
	}
	hasDay := false
	for dayRows.Next() {
		var name, focus, exercises string
		if dayRows.Scan(&name, &focus, &exercises) == nil {
			hasDay = true
			summary.WriteString(fmt.Sprintf("[%s (foco: %s): %s] ", name, focus, exercises))
		}
	}
	dayRows.Close()
	if !hasDay {
		summary.WriteString("nenhum ainda — este é o primeiro dia do plano. ")
	}

	summary.WriteString("Treinos concluídos recentes neste plano: ")
	workoutRows, err := database.Pool.Query(ctx,
		`SELECT w.date::date, w.name, COALESCE(string_agg(ws.exercise_name, ', ' ORDER BY ws.id), '')
		 FROM workouts w LEFT JOIN workout_sets ws ON ws.workout_id = w.id
		 WHERE w.status = 'completed' AND w.training_plan_day_id IN
		   (SELECT id FROM training_plan_days WHERE plan_id = $1)
		 GROUP BY w.id ORDER BY w.date DESC LIMIT 10`, planID)
	if err != nil {
		return "", err
	}
	defer workoutRows.Close()
	anyWorkout := false
	for workoutRows.Next() {
		var date time.Time
		var name, exercises string
		if workoutRows.Scan(&date, &name, &exercises) == nil {
			anyWorkout = true
			summary.WriteString(fmt.Sprintf("[%s %s: %s] ", date.Format("2006-01-02"), name, exercises))
		}
	}
	if !anyWorkout {
		summary.WriteString("nenhum ainda.")
	}
	return summary.String(), nil
}
