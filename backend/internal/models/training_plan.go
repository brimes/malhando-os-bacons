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
	// Kind is "regular" for the person's real plan, "compensation" for a
	// cheat-day compensation, or "dynamic" for a plan that grows one day at a
	// time instead of coming complete. ExpiresAt is only set for compensation
	// plans.
	Kind      string     `json:"kind"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	// ArchivedAt is set once the plan has passed its target date and the
	// person archived it — it stops showing in the default list but is never
	// deleted, since workouts and sets still point at its days.
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
	GymID      *int64     `json:"gym_id,omitempty"`
	// GymName vem de um LEFT JOIN, só para a tela não precisar de outra
	// chamada para mostrar onde o plano foi montado.
	GymName     *string           `json:"gym_name,omitempty"`
	Preferences string            `json:"preferences"`
	Days        []TrainingPlanDay `json:"days,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
}

type TrainingPlanDay struct {
	ID           int64      `json:"id"`
	DayNumber    int        `json:"day_number"`
	Name         string     `json:"name"`
	Focus        string     `json:"focus"`
	Instructions string     `json:"instructions"`
	LastDoneAt   *time.Time `json:"last_done_at,omitempty"`
	// GeneratedFor/GeneratedAt só existem em dias de plano dinâmico: dizem para
	// que data o dia foi gerado e quando, já que o dia não tem um "dia da
	// semana" fixo como nos outros tipos de plano.
	GeneratedFor *time.Time             `json:"generated_for,omitempty"`
	GeneratedAt  *time.Time             `json:"generated_at,omitempty"`
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
	// VideoStatus é "not_found" só quando o associador JÁ decidiu que o
	// catálogo não tem este exercício (recusa gravada em exercise_video_links).
	// Vazio significa "ainda não associado" — que não é o mesmo e não deve
	// mostrar "não localizamos o vídeo", porque a associação pode acontecer.
	VideoStatus string `json:"video_status,omitempty"`
	// Illustration vem só quando já existe ilustração gerada por IA pronta
	// para este nome (cache global em exercise_illustrations).
	Illustration *ExerciseIllustration `json:"illustration,omitempty"`
	// SubstitutedFrom só vem preenchido pela sessão ativa (ActiveWorkout), e só
	// quando o exercício foi trocado com scope="session" — o plano (e este
	// mesmo campo em qualquer outra leitura) nunca vê essa troca, porque ela
	// vale só para este treino. Guarda o nome original para a tela explicar a
	// troca; sem ele a pessoa só veria um exercício diferente do que memorizou.
	SubstitutedFrom *string `json:"substituted_from,omitempty"`
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

// ExerciseIllustration indica que há ilustração pronta; a imagem em si é
// buscada em GET /api/exercise-illustrations/image.
type ExerciseIllustration struct {
	// "ready" ou "outdated" (versão antiga, imagem única: o app regenera).
	Status string `json:"status"`
	Frames int    `json:"frames,omitempty"`
}

type TrainingPlanInput struct {
	Name                   string                 `json:"name"`
	Description            string                 `json:"description"`
	TargetDate             string                 `json:"target_date"`
	DaysPerWeek            int                    `json:"days_per_week"`
	SessionDurationMinutes int                    `json:"session_duration_minutes"`
	Days                   []TrainingPlanDayInput `json:"days"`
	// GymID e Preferences são opcionais e só usados na criação (manual ou
	// automática); o ajuste (Adjust/applyAdjustment) não mexe neles.
	GymID       *int64 `json:"gym_id,omitempty"`
	Preferences string `json:"preferences,omitempty"`
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
	GymID                  *int64 `json:"gym_id,omitempty"`
}

// DynamicTrainingPlanRequest creates a kind='dynamic' plan: only the
// configuration, no days — those are generated one at a time later via
// POST /api/training-plans/{id}/dynamic-day.
type DynamicTrainingPlanRequest struct {
	Name                   string `json:"name"`
	TargetDate             string `json:"target_date"`
	DaysPerWeek            int    `json:"days_per_week"`
	SessionDurationMinutes int    `json:"session_duration_minutes"`
	Preferences            string `json:"preferences"`
	GymID                  *int64 `json:"gym_id,omitempty"`
}

// TrainingPlanJob tracks an automatic plan generation (or a dynamic-day
// generation) running in background, since the assistant takes far longer
// than a request can be held open.
type TrainingPlanJob struct {
	ID     int64  `json:"id"`
	Status string `json:"status"`
	PlanID *int64 `json:"plan_id,omitempty"`
	// PlanDayID só é preenchido por um job de dynamic-day: é o dia recém
	// gerado, para a tela ir direto a ele sem recarregar o plano inteiro.
	PlanDayID *int64    `json:"plan_day_id,omitempty"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}
