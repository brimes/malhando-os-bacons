package models

import "time"

// ProgressReview is one deep read of the period: how the person actually
// trained and ate, whether that is taking them to the goal, and — only when
// it is not — a concrete change to the plans, already generated and waiting
// for confirmation.
//
// It doubles as the job that produced it (status pending/ready/failed): the
// analysis runs for minutes against the assistant, so the endpoint answers
// 202 and the screen polls this same row.
type ProgressReview struct {
	ID          int64  `json:"id"`
	Status      string `json:"status"`
	PeriodStart string `json:"period_start"`
	PeriodEnd   string `json:"period_end"`

	Performance    string `json:"performance"`
	GoalAssessment string `json:"goal_assessment"`
	// GoalStatus is on_track, needs_change or at_risk — what the screen colors
	// the objective card by, so it does not have to parse the prose.
	GoalStatus string `json:"goal_status"`

	// Nil when there is nothing to change in that plan, which is the answer
	// whenever the current one is working.
	TrainingChange  *ProposedTrainingChange  `json:"training_change,omitempty"`
	NutritionChange *ProposedNutritionChange `json:"nutrition_change,omitempty"`

	AppliedTraining  bool   `json:"applied_training"`
	AppliedNutrition bool   `json:"applied_nutrition"`
	Error            string `json:"error,omitempty"`

	CreatedAt time.Time  `json:"created_at"`
	AppliedAt *time.Time `json:"applied_at,omitempty"`
}

// ProposedTrainingChange carries the whole proposed plan, not a diff: it is
// what gets written verbatim if the person confirms, so the screen can show
// exactly what will happen. Current* fields are what it replaces, for the
// before/after on screen.
type ProposedTrainingChange struct {
	PlanID      int64             `json:"plan_id"`
	PlanName    string            `json:"plan_name"`
	Summary     string            `json:"summary"`
	Plan        TrainingPlanInput `json:"plan"`
	CurrentPlan TrainingPlanInput `json:"current_plan"`
}

type ProposedNutritionChange struct {
	PlanID      int64              `json:"plan_id"`
	PlanName    string             `json:"plan_name"`
	Summary     string             `json:"summary"`
	Plan        NutritionPlanInput `json:"plan"`
	CurrentPlan NutritionPlanInput `json:"current_plan"`
}

// ApplyProgressReviewRequest lets the person take only part of what was
// proposed — accepting the nutrition change while keeping the training plan
// is a legitimate answer.
type ApplyProgressReviewRequest struct {
	ApplyTraining  bool `json:"apply_training"`
	ApplyNutrition bool `json:"apply_nutrition"`
}

// ProgressReviewAnalysis is what the assistant returns in the first pass. The
// change fields are instructions in free text, not plans: the concrete plan
// comes from a second call to the same Adjust the manual "ajustar plano" flow
// uses, so there is exactly one code path that rewrites a plan.
type ProgressReviewAnalysis struct {
	Performance     string                 `json:"performance"`
	GoalAssessment  string                 `json:"goal_assessment"`
	GoalStatus      string                 `json:"goal_status"`
	TrainingChange  ProgressReviewProposal `json:"training_change"`
	NutritionChange ProgressReviewProposal `json:"nutrition_change"`
}

type ProgressReviewProposal struct {
	Needed bool `json:"needed"`
	// Summary is written for the person: what changes and why, in plain
	// Portuguese. Instructions is written for the plan assistant.
	Summary      string `json:"summary"`
	Instructions string `json:"instructions"`
}
