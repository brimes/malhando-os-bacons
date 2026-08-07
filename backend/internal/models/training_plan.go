package models

import "time"

type TrainingPlan struct {
	ID                     int64     `json:"id"`
	Name                   string    `json:"name"`
	Description            string    `json:"description"`
	TargetDate             time.Time `json:"target_date"`
	DaysPerWeek            int       `json:"days_per_week"`
	SessionDurationMinutes int       `json:"session_duration_minutes"`
	CreationMethod         string    `json:"creation_method"`
	AdaptationPhase        bool      `json:"adaptation_phase"`
	Active                 bool      `json:"active"`
	// Kind is "regular" for the person's real plan or "compensation" for a
	// cheat-day compensation — a separate row so the real plan is never
	// touched. ExpiresAt is only set for compensation plans.
	Kind      string            `json:"kind"`
	ExpiresAt *time.Time        `json:"expires_at,omitempty"`
	Days      []TrainingPlanDay `json:"days,omitempty"`
	CreatedAt time.Time         `json:"created_at"`
}

type TrainingPlanDay struct {
	ID           int64                  `json:"id"`
	DayNumber    int                    `json:"day_number"`
	Name         string                 `json:"name"`
	Focus        string                 `json:"focus"`
	Instructions string                 `json:"instructions"`
	LastDoneAt   *time.Time             `json:"last_done_at,omitempty"`
	Exercises    []TrainingPlanExercise `json:"exercises"`
}

type TrainingPlanExercise struct {
	ID              int64    `json:"id"`
	ExerciseName    string   `json:"exercise_name"`
	Sets            int      `json:"sets"`
	Reps            int      `json:"reps"`
	TrackingType    string   `json:"tracking_type"`
	DurationSeconds *int     `json:"duration_seconds,omitempty"`
	RestSeconds     int      `json:"rest_seconds"`
	Notes           string   `json:"notes"`
	LastWeightKg    *float64 `json:"last_weight_kg,omitempty"`
	// Video é nil quando não há vídeo para este exercício — porque o vínculo
	// ainda não foi resolvido, ou porque foi resolvido como "não existe".
	// O app trata os dois casos igual: mostra o exercício sem vídeo.
	Video *ExerciseVideo `json:"video,omitempty"`
}

// ExerciseVideo é o apontamento para o vídeo demonstrativo no bucket.
//
// CatalogName é o nome no catálogo, que pode ser diferente de ExerciseName — é
// justamente por serem vocabulários distintos que existe a tabela de vínculo.
// Os dois caminhos vêm juntos porque quem escolhe o formato é o aparelho: iOS
// leva mp4 (o WKWebView antigo não toca WebM), Android leva webm.
type ExerciseVideo struct {
	CatalogName string `json:"catalog_name"`
	WebM        string `json:"webm"`
	MP4         string `json:"mp4"`
}

type TrainingPlanInput struct {
	Name                   string                 `json:"name"`
	Description            string                 `json:"description"`
	TargetDate             string                 `json:"target_date"`
	DaysPerWeek            int                    `json:"days_per_week"`
	SessionDurationMinutes int                    `json:"session_duration_minutes"`
	Days                   []TrainingPlanDayInput `json:"days"`
}

type TrainingPlanDayInput struct {
	Name         string                      `json:"name"`
	Focus        string                      `json:"focus"`
	Instructions string                      `json:"instructions"`
	Exercises    []TrainingPlanExerciseInput `json:"exercises"`
}

type TrainingPlanExerciseInput struct {
	ExerciseName    string `json:"exercise_name"`
	Sets            int    `json:"sets"`
	Reps            int    `json:"reps"`
	TrackingType    string `json:"tracking_type"`
	DurationSeconds *int   `json:"duration_seconds"`
	RestSeconds     int    `json:"rest_seconds"`
	Notes           string `json:"notes"`
}

type AutomaticTrainingPlanRequest struct {
	Name                   string `json:"name"`
	TargetDate             string `json:"target_date"`
	DaysPerWeek            int    `json:"days_per_week"`
	SessionDurationMinutes int    `json:"session_duration_minutes"`
	Preferences            string `json:"preferences"`
}

// TrainingPlanJob tracks an automatic plan generation running in background,
// since the assistant takes far longer than a request can be held open.
type TrainingPlanJob struct {
	ID        int64     `json:"id"`
	Status    string    `json:"status"`
	PlanID    *int64    `json:"plan_id,omitempty"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}
