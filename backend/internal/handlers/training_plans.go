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
	db       *db.DB
	resolver services.GeneratorResolver
	matcher  services.ExerciseVideoMatcher
}

func NewTrainingPlanHandler(database *db.DB, resolver services.GeneratorResolver) *TrainingPlanHandler {
	return &TrainingPlanHandler{
		db:       database,
		resolver: resolver,
		matcher:  services.NewExerciseVideoMatcher(database, resolver),
	}
}

// associarVideosEmSegundoPlano liga os nomes de exercício do plano ao catálogo
// de vídeos, fora da requisição.
//
// Fora porque a associação pode chamar o assistente, e um plano manual é criado
// numa requisição síncrona: fazer a pessoa esperar por um vídeo demonstrativo
// para receber o plano que ela acabou de montar inverte as prioridades. O plano
// vale sem vídeo; o vínculo aparece na próxima leitura.
//
// O contexto é novo de propósito: o da requisição é cancelado assim que a
// resposta sai, e a associação morreria no meio.
func (h *TrainingPlanHandler) associarVideosEmSegundoPlano(userID int64, plan *models.TrainingPlan) {
	nomes := make([]string, 0, 32)
	for _, day := range plan.Days {
		for _, exercise := range day.Exercises {
			nomes = append(nomes, exercise.ExerciseName)
		}
	}
	if len(nomes) == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := h.matcher.EnsureLinks(ctx, userID, nomes); err != nil {
			// Já registrado com detalhe pelo associador. O plano continua
			// válido: os nomes seguem sem vínculo e a próxima geração tenta
			// de novo, porque nada foi gravado para eles.
			slog.Warn("plano criado sem vínculos de vídeo", "plan_id", plan.ID, "user_id", userID)
		}
	}()
}

// assistantFor builds the assistant on the credentials of this user: their own
// API key when they saved one, the shared credits otherwise. It is resolved per
// call because the key can change between two generations.
func (h *TrainingPlanHandler) assistantFor(ctx context.Context, userID int64) services.TrainingPlanAssistant {
	return services.NewTrainingPlanAssistant(h.resolver.For(ctx, userID))
}

// List returns the person's real plans — regular and dynamic. Compensation
// plans (kind = 'compensation') are always active=false and have their own
// display surface via the cheat-day flow — mixing them into this history
// would make an expired indulgence look like an abandoned training plan.
//
// ?archived=true flips to the archived list instead of the default one: a
// plan is either live (archived_at IS NULL) or archived, never both, so the
// two lists never overlap.
func (h *TrainingPlanHandler) List(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	archived := r.URL.Query().Get("archived") == "true"
	query := `SELECT tp.id, tp.name, tp.description, tp.target_date, tp.days_per_week, tp.session_duration_minutes,
	 tp.creation_method, tp.adaptation_phase, tp.active, tp.kind, tp.archived_at, tp.gym_id, g.name, tp.preferences, tp.created_at
	 FROM training_plans tp LEFT JOIN gyms g ON g.id = tp.gym_id
	 WHERE tp.user_id = $1 AND tp.kind IN ('regular', 'dynamic') AND tp.archived_at IS `
	if archived {
		query += `NOT NULL ORDER BY tp.archived_at DESC`
	} else {
		query += `NULL ORDER BY tp.active DESC, tp.created_at DESC`
	}
	rows, err := h.db.Pool.Query(r.Context(), query, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load training plans"})
		return
	}
	defer rows.Close()
	plans := []models.TrainingPlan{}
	for rows.Next() {
		var plan models.TrainingPlan
		if err := rows.Scan(&plan.ID, &plan.Name, &plan.Description, &plan.TargetDate, &plan.DaysPerWeek,
			&plan.SessionDurationMinutes, &plan.CreationMethod, &plan.AdaptationPhase, &plan.Active, &plan.Kind,
			&plan.ArchivedAt, &plan.GymID, &plan.GymName, &plan.Preferences, &plan.CreatedAt); err == nil {
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
		`SELECT tp.id, tp.name, tp.description, tp.target_date, tp.days_per_week, tp.session_duration_minutes,
		 tp.creation_method, tp.adaptation_phase, tp.active, tp.kind, tp.expires_at, tp.archived_at,
		 tp.gym_id, g.name, tp.preferences, tp.created_at
		 FROM training_plans tp LEFT JOIN gyms g ON g.id = tp.gym_id
		 WHERE tp.id = $1 AND tp.user_id = $2`, id, userID,
	).Scan(&plan.ID, &plan.Name, &plan.Description, &plan.TargetDate, &plan.DaysPerWeek,
		&plan.SessionDurationMinutes, &plan.CreationMethod, &plan.AdaptationPhase, &plan.Active,
		&plan.Kind, &plan.ExpiresAt, &plan.ArchivedAt, &plan.GymID, &plan.GymName, &plan.Preferences, &plan.CreatedAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "training plan not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load training plan"})
		return
	}

	// Plano dinâmico não tem "os dias da semana": tem uma lista que só cresce.
	// Devolver todo o histórico deixaria a tela cada vez mais pesada, então só
	// os 10 mais recentes voltam, com o de hoje primeiro.
	dayOrder, dayLimit := "d.day_number", ""
	if plan.Kind == "dynamic" {
		dayOrder, dayLimit = "d.day_number DESC", " LIMIT 10"
	}
	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT d.id, d.day_number, d.name, d.focus, d.instructions, d.generated_for, d.generated_at, MAX(w.date)
		 FROM training_plan_days d LEFT JOIN workouts w ON w.training_plan_day_id = d.id AND w.status = 'completed'
		 WHERE d.plan_id = $1 GROUP BY d.id ORDER BY `+dayOrder+dayLimit, plan.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load plan days"})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var day models.TrainingPlanDay
		if err := rows.Scan(&day.ID, &day.DayNumber, &day.Name, &day.Focus, &day.Instructions,
			&day.GeneratedFor, &day.GeneratedAt, &day.LastDoneAt); err != nil {
			continue
		}
		// O LEFT JOIN traz o vídeo demonstrativo quando o nome já foi
		// associado ao catálogo. É LEFT porque a maioria dos nomes não casa
		// com o catálogo e o exercício vale sem vídeo — um INNER esconderia
		// o exercício inteiro.
		exerciseRows, err := h.db.Pool.Query(r.Context(),
			`SELECT e.id, e.exercise_name, e.sets, e.reps, e.tracking_type, e.duration_seconds,
			        e.rest_seconds, e.notes, e.last_weight_kg,
			        v.catalog_name, v.object_webm, v.object_mp4
			 FROM training_plan_exercises e
			 LEFT JOIN exercise_video_links v ON v.exercise_name = e.exercise_name
			 WHERE e.plan_day_id = $1 ORDER BY e.exercise_order`, day.ID)
		if err != nil {
			continue
		}
		day.Exercises = []models.TrainingPlanExercise{}
		for exerciseRows.Next() {
			var exercise models.TrainingPlanExercise
			var catalogo, webm, mp4 *string
			if err := exerciseRows.Scan(&exercise.ID, &exercise.ExerciseName, &exercise.Sets, &exercise.Reps,
				&exercise.TrackingType, &exercise.DurationSeconds, &exercise.RestSeconds, &exercise.Notes,
				&exercise.LastWeightKg, &catalogo, &webm, &mp4); err == nil {
				exercise.Video = montarVideo(catalogo, webm, mp4)
				day.Exercises = append(day.Exercises, exercise)
			}
		}
		exerciseRows.Close()
		plan.Days = append(plan.Days, day)
	}
	writeJSON(w, http.StatusOK, plan)
}

// GetCompensation returns the currently valid cheat-day compensation plan, if
// any — the one non-expired kind='compensation' row with no completed workout
// against it yet, so the dashboard and the plan screen can surface it as a
// standalone extra session without the person having to dig through the
// cheat-day conversation history. Once its day has been trained it stops
// being offered here — it already shows up as a normal completed session in
// the workout history, so nothing about it needs a special "done" surface.
func (h *TrainingPlanHandler) GetCompensation(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var id int64
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT tp.id FROM training_plans tp
		 WHERE tp.user_id = $1 AND tp.kind = 'compensation' AND tp.expires_at >= CURRENT_DATE
		 AND NOT EXISTS (
		   SELECT 1 FROM workouts w
		   JOIN training_plan_days d ON d.id = w.training_plan_day_id
		   WHERE d.plan_id = tp.id AND w.status = 'completed'
		 )
		 ORDER BY tp.created_at DESC LIMIT 1`, userID,
	).Scan(&id)
	if err == pgx.ErrNoRows {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load compensation plan"})
		return
	}
	r.URL.Path = fmt.Sprintf("/api/training-plans/%d", id)
	h.Get(w, r)
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
	if err := validateGymOwnership(r.Context(), h.db, userID, input.GymID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
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
	// Validado aqui, síncrono, para devolver 400 na hora — validar só dentro da
	// goroutine deixaria o erro aparecer minutos depois, no polling do job.
	if err := validateGymOwnership(r.Context(), h.db, userID, req.GymID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	userContext, err := buildUserContext(r.Context(), h.db, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare training context"})
		return
	}
	gymContext, err := buildGymContext(r.Context(), h.db, userID, req.GymID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare training context"})
		return
	}
	userContext += gymContext
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

	input, err := h.assistantFor(ctx, userID).Generate(ctx, userContext, req)
	if err != nil {
		fail("the training plan assistant is temporarily unavailable", err)
		return
	}
	// gym_id e preferences não fazem parte do schema que o assistente devolve
	// (são entrada, não saída) — vêm de volta aqui, do pedido original.
	input.GymID = req.GymID
	input.Preferences = req.Preferences
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
		`SELECT id, status, plan_id, plan_day_id, error, created_at FROM training_plan_jobs
		 WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&job.ID, &job.Status, &job.PlanID, &job.PlanDayID, &job.Error, &job.CreatedAt)
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
		 session_duration_minutes, creation_method, adaptation_phase, gym_id, preferences)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 RETURNING id,name,description,target_date,days_per_week,session_duration_minutes,
		 creation_method,adaptation_phase,active,gym_id,preferences,created_at`,
		userID, input.Name, strings.TrimSpace(input.Description), targetDate, input.DaysPerWeek,
		input.SessionDurationMinutes, method, adaptation, input.GymID, strings.TrimSpace(input.Preferences),
	).Scan(&plan.ID, &plan.Name, &plan.Description, &plan.TargetDate, &plan.DaysPerWeek,
		&plan.SessionDurationMinutes, &plan.CreationMethod, &plan.AdaptationPhase, &plan.Active,
		&plan.GymID, &plan.Preferences, &plan.CreatedAt)
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
	h.associarVideosEmSegundoPlano(userID, &plan)
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

// buildUserContext summarises who the person is and what they have been doing,
// in the shape the assistants expect. It is a package function, not a method,
// because the workout chat needs exactly the same summary without going through
// the training plan handler.
func buildUserContext(ctx context.Context, database *db.DB, userID int64) (string, error) {
	var birthDate time.Time
	var height, weight float64
	var sex, injuries, experience *string
	var adaptation *time.Time
	err := database.Pool.QueryRow(ctx,
		`SELECT birth_date,height_cm,current_weight_kg,biological_sex,injuries_or_limitations,
		 training_experience,adaptation_ends_at FROM user_profiles WHERE user_id=$1`, userID,
	).Scan(&birthDate, &height, &weight, &sex, &injuries, &experience, &adaptation)
	if err != nil {
		return "", err
	}
	summary := fmt.Sprintf("Perfil: nascimento=%s, altura=%.1fcm, peso=%.1fkg, sexo=%v, experiência=%v, adaptação até=%v, lesões/limitações=%v. ",
		birthDate.Format("2006-01-02"), height, weight, pointerValue(sex), pointerValue(experience), timePointerValue(adaptation), pointerValue(injuries))
	var goalSummary string
	_ = database.Pool.QueryRow(ctx, `SELECT summary FROM user_goals WHERE user_id=$1`, userID).Scan(&goalSummary)
	summary += "Objetivo: " + goalSummary + ". Histórico recente: "
	var fitnessDistance, fitnessExertion int
	if database.Pool.QueryRow(ctx,
		`SELECT distance_meters, perceived_exertion FROM fitness_assessments
		 WHERE user_id=$1 ORDER BY performed_at DESC LIMIT 1`, userID,
	).Scan(&fitnessDistance, &fitnessExertion) == nil {
		summary += fmt.Sprintf("Última caminhada de 6 minutos: %dm, esforço %d/10. ", fitnessDistance, fitnessExertion)
	}
	rows, err := database.Pool.Query(ctx,
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

// Archive só é permitido depois que a data-alvo passou — arquivar um plano em
// andamento apagaria da lista algo que a pessoa ainda está seguindo. Não
// apaga nada: dias e séries continuam com o histórico intacto, só o plano some
// da listagem padrão.
func (h *TrainingPlanHandler) Archive(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parsePlanIDFromAdjustPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid training plan id"})
		return
	}
	var targetDate time.Time
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT target_date FROM training_plans WHERE id = $1 AND user_id = $2`, id, userID).Scan(&targetDate)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "training plan not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load training plan"})
		return
	}
	if !targetDate.Before(time.Now().Truncate(24 * time.Hour)) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "plan has not reached its target date"})
		return
	}
	if _, err := h.db.Pool.Exec(r.Context(),
		`UPDATE training_plans SET archived_at = NOW(), active = false, updated_at = NOW() WHERE id = $1`, id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to archive training plan"})
		return
	}
	r.URL.Path = fmt.Sprintf("/api/training-plans/%d", id)
	h.Get(w, r)
}

// Unarchive não tem a mesma restrição de data: a pessoa pode querer voltar a
// ver um plano vencido antes de decidir o próximo.
func (h *TrainingPlanHandler) Unarchive(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parsePlanIDFromAdjustPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid training plan id"})
		return
	}
	tag, err := h.db.Pool.Exec(r.Context(),
		`UPDATE training_plans SET archived_at = NULL, active = true, updated_at = NOW()
		 WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to unarchive training plan"})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "training plan not found"})
		return
	}
	r.URL.Path = fmt.Sprintf("/api/training-plans/%d", id)
	h.Get(w, r)
}

// validateGymOwnership confere que a academia informada (se houver) é do
// próprio usuário, antes de gravá-la num plano. gymID nil é sempre válido —
// "sem academia" continua sendo uma opção normal.
func validateGymOwnership(ctx context.Context, database *db.DB, userID int64, gymID *int64) error {
	if gymID == nil {
		return nil
	}
	var exists bool
	if err := database.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM gyms WHERE id = $1 AND user_id = $2)`, *gymID, userID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("gym does not belong to user")
	}
	return nil
}

// buildGymContext monta o trecho de contexto com o nome e os aparelhos da
// academia escolhida, para o assistente só prescrever o que é executável ali
// — a regra em si mora no system prompt (gymEquipmentRule), aqui só entram os
// dados. Sem academia (gymID nil), devolve string vazia sem erro: nada muda no
// prompt, o comportamento de antes desta feature.
func buildGymContext(ctx context.Context, database *db.DB, userID int64, gymID *int64) (string, error) {
	if gymID == nil {
		return "", nil
	}
	var name string
	if err := database.Pool.QueryRow(ctx,
		`SELECT name FROM gyms WHERE id = $1 AND user_id = $2`, *gymID, userID).Scan(&name); err != nil {
		return "", err
	}
	rows, err := database.Pool.Query(ctx,
		`SELECT name FROM gym_equipment WHERE gym_id = $1 ORDER BY name`, *gymID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var equipment []string
	for rows.Next() {
		var item string
		if rows.Scan(&item) == nil {
			equipment = append(equipment, item)
		}
	}
	list := "nenhum aparelho cadastrado (considere apenas peso corporal)"
	if len(equipment) > 0 {
		list = strings.Join(equipment, ", ")
	}
	return fmt.Sprintf(" Academia escolhida: %s. Aparelhos disponíveis: %s.", name, list), nil
}
