package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

// progressReviewTimeout covers the whole background pass: one analysis call
// plus, at most, one plan-rewrite call per plan. Each of those alone is the
// same order as an automatic plan generation.
const progressReviewTimeout = 8 * time.Minute

// ProgressReviewHandler holds the training and nutrition handlers rather than
// re-implementing their reconciliation. applyAdjustment and
// applyNutritionAdjustment are the only two functions allowed to rewrite a
// plan in place — that is what keeps `workouts`/`workout_sets` attached to the
// days and exercises they reference, and duplicating them here would be a
// second place for that invariant to be broken.
type ProgressReviewHandler struct {
	db        *db.DB
	resolver  services.GeneratorResolver
	training  *TrainingPlanHandler
	nutrition *NutritionHandler
}

func NewProgressReviewHandler(database *db.DB, resolver services.GeneratorResolver,
	training *TrainingPlanHandler, nutrition *NutritionHandler) *ProgressReviewHandler {
	return &ProgressReviewHandler{db: database, resolver: resolver, training: training, nutrition: nutrition}
}

const progressReviewColumns = `id, status, period_start, period_end, performance, goal_assessment,
	 goal_status, training_plan_id, training_summary, training_proposal, training_proposal_error,
	 nutrition_plan_id, nutrition_summary, nutrition_proposal, nutrition_proposal_error,
	 applied_training, applied_nutrition, error, created_at, applied_at`

// Create starts an evaluation. It answers 202 with the row and runs the
// analysis detached, like every other assistant call that takes minutes.
func (h *ProgressReviewHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())

	start, end := reviewPeriod(r.Context(), h.db, userID)
	reviewContext, err := buildProgressReviewContext(r.Context(), h.db, userID, start, end)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "complete seu perfil antes de pedir uma avaliação"})
		return
	}

	var reviewID int64
	err = h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO progress_reviews (user_id, status, period_start, period_end)
		 VALUES ($1,'pending',$2,$3) RETURNING id`,
		userID, start.Format("2006-01-02"), end.Format("2006-01-02")).Scan(&reviewID)
	if err != nil {
		// The partial unique index is what rejects a second concurrent run;
		// answering 409 lets the screen attach to the one already going instead
		// of showing a failure the person cannot act on.
		if existing, loadErr := h.loadPending(r.Context(), userID); loadErr == nil {
			writeJSON(w, http.StatusConflict, existing)
			return
		}
		slog.Error("failed to create progress review", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to start the evaluation"})
		return
	}

	go h.run(reviewID, userID, reviewContext)

	review, err := h.load(r.Context(), userID, reviewID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load the evaluation"})
		return
	}
	writeJSON(w, http.StatusAccepted, review)
}

// Get is what the screen polls while status is pending.
func (h *ProgressReviewHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid review id"})
		return
	}
	review, err := h.load(r.Context(), userID, id)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "avaliação não encontrada"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load the evaluation"})
		return
	}
	writeJSON(w, http.StatusOK, review)
}

// Latest reopens the last evaluation when the screen loads, so the analysis is
// still there after the app is closed — including one still running.
func (h *ProgressReviewHandler) Latest(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var id int64
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT id FROM progress_reviews WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, userID).Scan(&id)
	if err == pgx.ErrNoRows {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load the evaluation"})
		return
	}
	review, err := h.load(r.Context(), userID, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load the evaluation"})
		return
	}
	writeJSON(w, http.StatusOK, review)
}

// Apply writes the proposals the person confirmed. Nothing is written until
// this call: an evaluation the person never opened changes nothing.
func (h *ProgressReviewHandler) Apply(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid review id"})
		return
	}
	var req models.ApplyProgressReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	review, err := h.load(r.Context(), userID, id)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "avaliação não encontrada"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load the evaluation"})
		return
	}
	if review.Status != "ready" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "esta avaliação já foi resolvida"})
		return
	}

	applyTraining := req.ApplyTraining && review.TrainingChange != nil
	applyNutrition := req.ApplyNutrition && review.NutritionChange != nil
	if !applyTraining && !applyNutrition {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "nenhuma alteração selecionada"})
		return
	}

	// The snapshot goes in first, and it is the plan as it is right now — read
	// back from the database, not the copy the review carries. Between the
	// evaluation and this confirmation the person may have adjusted the plan by
	// hand, and what has to be recoverable is what is actually being replaced.
	if applyTraining {
		current, loadErr := h.training.loadPlanInput(r.Context(), review.TrainingChange.PlanID, userID)
		if loadErr != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "o plano de treino avaliado não existe mais"})
			return
		}
		if err := h.snapshotPlan(r.Context(), userID, id, "training", review.TrainingChange.PlanID,
			current.Name, current, review.TrainingChange.Summary); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to archive the current training plan"})
			return
		}
		if err := h.training.applyAdjustment(r.Context(), review.TrainingChange.PlanID, review.TrainingChange.Plan); err != nil {
			slog.Error("failed to apply reviewed training plan", "user_id", userID, "review_id", id, "error", err)
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "não foi possível aplicar a alteração no treino"})
			return
		}
	}
	if applyNutrition {
		current, loadErr := h.nutrition.loadNutritionPlanInput(r.Context(), review.NutritionChange.PlanID, userID)
		if loadErr != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "o plano nutricional avaliado não existe mais"})
			return
		}
		if err := h.snapshotPlan(r.Context(), userID, id, "nutrition", review.NutritionChange.PlanID,
			current.Name, current, review.NutritionChange.Summary); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to archive the current nutrition plan"})
			return
		}
		if err := h.nutrition.applyNutritionAdjustment(r.Context(), review.NutritionChange.PlanID, review.NutritionChange.Plan); err != nil {
			slog.Error("failed to apply reviewed nutrition plan", "user_id", userID, "review_id", id, "error", err)
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "não foi possível aplicar a alteração na nutrição"})
			return
		}
	}

	if _, err := h.db.Pool.Exec(r.Context(),
		`UPDATE progress_reviews SET status='applied', applied_training=$3, applied_nutrition=$4,
		 applied_at=NOW(), updated_at=NOW() WHERE id=$1 AND user_id=$2`,
		id, userID, applyTraining, applyNutrition); err != nil {
		slog.Error("failed to mark progress review as applied", "review_id", id, "error", err)
	}

	updated, err := h.load(r.Context(), userID, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load the evaluation"})
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// Discard keeps the analysis readable but closes the proposal, so the screen
// stops offering a change the person already said no to.
func (h *ProgressReviewHandler) Discard(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid review id"})
		return
	}
	tag, err := h.db.Pool.Exec(r.Context(),
		`UPDATE progress_reviews SET status='discarded', updated_at=NOW()
		 WHERE id=$1 AND user_id=$2 AND status='ready'`, id, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to discard the evaluation"})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "avaliação não encontrada"})
		return
	}
	review, err := h.load(r.Context(), userID, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load the evaluation"})
		return
	}
	writeJSON(w, http.StatusOK, review)
}

// run is the whole background pass: analyze, then turn each change the
// analysis asked for into a concrete plan. Producing the plans here — rather
// than at confirmation time — is what makes the screen's "confirmar" honest:
// what the person reads is the plan that gets written, byte for byte.
func (h *ProgressReviewHandler) run(reviewID, userID int64, reviewContext string) {
	ctx, cancel := context.WithTimeout(context.Background(), progressReviewTimeout)
	defer cancel()

	fail := func(message string, err error) {
		slog.Error(message, "user_id", userID, "review_id", reviewID, "error", err)
		if _, updateErr := h.db.Pool.Exec(context.Background(),
			`UPDATE progress_reviews SET status='failed', error=$2, updated_at=NOW() WHERE id=$1`,
			reviewID, message); updateErr != nil {
			slog.Error("failed to mark progress review as failed", "review_id", reviewID, "error", updateErr)
		}
	}

	generator := h.resolver.For(ctx, userID)
	analysis, err := services.NewProgressReviewAssistant(generator).Review(ctx, reviewContext)
	if err != nil {
		fail("o assistente está indisponível no momento; tente de novo em instantes", err)
		return
	}

	trainingPlanID, trainingProposal, trainingFailure := h.proposeTraining(ctx, userID, reviewContext, analysis.TrainingChange)
	nutritionPlanID, nutritionProposal, nutritionFailure := h.proposeNutrition(ctx, userID, reviewContext, analysis.NutritionChange)

	// A summary with no plan behind it cannot be offered for confirmation —
	// there would be nothing to write. But it is not silently dropped either:
	// the failure travels in its own field so the screen says what happened
	// instead of reporting that the plans were found adequate.
	trainingSummary := analysis.TrainingChange.Summary
	if trainingProposal == nil {
		trainingSummary = ""
	}
	nutritionSummary := analysis.NutritionChange.Summary
	if nutritionProposal == nil {
		nutritionSummary = ""
	}
	// The assistant judged the route has to change and produced no change at
	// all — the contradiction the repair pass in the assistant exists to
	// prevent. It can still get here if that pass also failed, and the screen
	// has to be told rather than left to invent an explanation.
	if analysis.GoalStatus != "on_track" && trainingProposal == nil && nutritionProposal == nil &&
		trainingFailure == "" && nutritionFailure == "" {
		trainingFailure = "o assistente apontou que a rota precisa mudar, mas não chegou a uma alteração concreta de plano"
	}

	if _, err := h.db.Pool.Exec(context.Background(),
		`UPDATE progress_reviews SET status='ready', performance=$2, goal_assessment=$3, goal_status=$4,
		 training_plan_id=$5, training_summary=$6, training_proposal=$7, training_proposal_error=$8,
		 nutrition_plan_id=$9, nutrition_summary=$10, nutrition_proposal=$11, nutrition_proposal_error=$12,
		 context_snapshot=$13, updated_at=NOW()
		 WHERE id=$1`,
		reviewID, analysis.Performance, analysis.GoalAssessment, analysis.GoalStatus,
		trainingPlanID, trainingSummary, trainingProposal, trainingFailure,
		nutritionPlanID, nutritionSummary, nutritionProposal, nutritionFailure,
		reviewContext); err != nil {
		fail("failed to save the evaluation", err)
	}
}

// proposalAttempts is 2 because the rewrite can fail for reasons that pass on a
// second try: the plan assistants validate their own output (calorie range,
// macro coherence, exercise limits) and reject a bad draft, which is a retry,
// not a dead end.
const proposalAttempts = 2

// proposeTraining returns the plan the assistant would write, without writing
// it. The third return value is why there is no plan, empty when there was
// nothing to propose in the first place — the caller stores it so the screen
// never has to guess.
func (h *ProgressReviewHandler) proposeTraining(ctx context.Context, userID int64, reviewContext string,
	change models.ProgressReviewProposal) (*int64, []byte, string) {
	if !change.Needed {
		return nil, nil, ""
	}
	var planID int64
	if h.db.Pool.QueryRow(ctx,
		`SELECT id FROM training_plans WHERE user_id=$1 AND active=true AND kind='regular' LIMIT 1`,
		userID).Scan(&planID) != nil {
		return nil, nil, "não há plano de treino ativo para alterar"
	}
	current, err := h.training.loadPlanInput(ctx, planID, userID)
	if err != nil {
		slog.Warn("progress review: could not load training plan", "user_id", userID, "error", err)
		return nil, nil, "não foi possível ler o plano de treino atual"
	}

	assistant := h.training.assistantFor(ctx, userID)
	for attempt := 1; attempt <= proposalAttempts; attempt++ {
		adjusted, adjustErr := assistant.Adjust(ctx, reviewContext, *current, change.Instructions)
		if adjustErr != nil {
			slog.Warn("progress review: training proposal failed", "user_id", userID,
				"attempt", attempt, "error", adjustErr)
			continue
		}
		encoded, marshalErr := json.Marshal(models.ProposedTrainingChange{
			PlanID:      planID,
			PlanName:    current.Name,
			Summary:     change.Summary,
			Plan:        *adjusted,
			CurrentPlan: *current,
		})
		if marshalErr == nil {
			return &planID, encoded, ""
		}
	}
	return nil, nil, "o assistente indicou uma mudança no treino, mas não conseguiu montar o plano ajustado"
}

func (h *ProgressReviewHandler) proposeNutrition(ctx context.Context, userID int64, reviewContext string,
	change models.ProgressReviewProposal) (*int64, []byte, string) {
	if !change.Needed {
		return nil, nil, ""
	}
	var planID int64
	if h.db.Pool.QueryRow(ctx,
		`SELECT id FROM nutrition_plans WHERE user_id=$1 AND active=true LIMIT 1`, userID).Scan(&planID) != nil {
		return nil, nil, "não há plano nutricional ativo para alterar"
	}
	current, err := h.nutrition.loadNutritionPlanInput(ctx, planID, userID)
	if err != nil {
		slog.Warn("progress review: could not load nutrition plan", "user_id", userID, "error", err)
		return nil, nil, "não foi possível ler o plano nutricional atual"
	}
	energy, daysPerWeek, err := h.nutrition.loadEnergyProfile(ctx, userID)
	if err != nil {
		return nil, nil, "complete seu perfil para que a nutrição possa ser recalculada"
	}

	assistant := h.nutrition.planAssistantFor(ctx, userID)
	for attempt := 1; attempt <= proposalAttempts; attempt++ {
		adjusted, adjustErr := assistant.Adjust(ctx, reviewContext, energy, daysPerWeek, *current, change.Instructions)
		if adjustErr != nil {
			slog.Warn("progress review: nutrition proposal failed", "user_id", userID,
				"attempt", attempt, "error", adjustErr)
			continue
		}
		encoded, marshalErr := json.Marshal(models.ProposedNutritionChange{
			PlanID:      planID,
			PlanName:    current.Name,
			Summary:     change.Summary,
			Plan:        *adjusted,
			CurrentPlan: *current,
		})
		if marshalErr == nil {
			return &planID, encoded, ""
		}
	}
	return nil, nil, "o assistente indicou uma mudança na nutrição, mas não conseguiu montar o plano ajustado"
}

// snapshotPlan archives the plan about to be overwritten. Applying reconciles
// in place, so this row is the only surviving copy of the previous version.
func (h *ProgressReviewHandler) snapshotPlan(ctx context.Context, userID, reviewID int64,
	kind string, planID int64, planName string, plan any, reason string) error {
	encoded, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	_, err = h.db.Pool.Exec(ctx,
		`INSERT INTO plan_revisions (user_id, review_id, kind, plan_id, plan_name, snapshot, reason)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`, userID, reviewID, kind, planID, planName, encoded, reason)
	return err
}

func (h *ProgressReviewHandler) loadPending(ctx context.Context, userID int64) (*models.ProgressReview, error) {
	var id int64
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT id FROM progress_reviews WHERE user_id=$1 AND status='pending'`, userID).Scan(&id); err != nil {
		return nil, err
	}
	return h.load(ctx, userID, id)
}

func (h *ProgressReviewHandler) load(ctx context.Context, userID, reviewID int64) (*models.ProgressReview, error) {
	var review models.ProgressReview
	var periodStart, periodEnd time.Time
	var trainingPlanID, nutritionPlanID *int64
	var trainingSummary, nutritionSummary string
	var trainingProposal, nutritionProposal []byte

	if err := h.db.Pool.QueryRow(ctx,
		`SELECT `+progressReviewColumns+` FROM progress_reviews WHERE id=$1 AND user_id=$2`,
		reviewID, userID,
	).Scan(&review.ID, &review.Status, &periodStart, &periodEnd, &review.Performance,
		&review.GoalAssessment, &review.GoalStatus, &trainingPlanID, &trainingSummary,
		&trainingProposal, &review.TrainingProposalError,
		&nutritionPlanID, &nutritionSummary, &nutritionProposal, &review.NutritionProposalError,
		&review.AppliedTraining, &review.AppliedNutrition, &review.Error,
		&review.CreatedAt, &review.AppliedAt); err != nil {
		return nil, err
	}
	review.PeriodStart = periodStart.Format("2006-01-02")
	review.PeriodEnd = periodEnd.Format("2006-01-02")

	// The proposals only travel while they are still an offer. Once applied or
	// discarded the analysis stays readable, but the change is over — sending
	// the plan back would let the screen show a button for a decision already
	// made.
	if review.Status == "ready" {
		if len(trainingProposal) > 0 {
			var change models.ProposedTrainingChange
			if json.Unmarshal(trainingProposal, &change) == nil {
				review.TrainingChange = &change
			}
		}
		if len(nutritionProposal) > 0 {
			var change models.ProposedNutritionChange
			if json.Unmarshal(nutritionProposal, &change) == nil {
				review.NutritionChange = &change
			}
		}
	}
	return &review, nil
}
