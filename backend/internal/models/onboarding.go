package models

import "time"

type UserProfile struct {
	BirthDate             time.Time  `json:"birth_date"`
	Age                   int        `json:"age"`
	HeightCM              float64    `json:"height_cm"`
	CurrentWeightKG       float64    `json:"current_weight_kg"`
	BiologicalSex         *string    `json:"biological_sex,omitempty"`
	InjuriesOrLimitations *string    `json:"injuries_or_limitations,omitempty"`
	TrainingExperience    *string    `json:"training_experience,omitempty"`
	AdaptationEndsAt      *time.Time `json:"adaptation_ends_at,omitempty"`
}

type OnboardingMessage struct {
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	Action    *string   `json:"action,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type UserGoal struct {
	GoalType                  string     `json:"goal_type"`
	TargetWeightKG            *float64   `json:"target_weight_kg,omitempty"`
	TargetBodyFatPercentage   *float64   `json:"target_body_fat_percentage,omitempty"`
	TargetMuscleMassKG        *float64   `json:"target_muscle_mass_kg,omitempty"`
	TargetSixMinuteWalkMeters *int       `json:"target_six_minute_walk_meters,omitempty"`
	ConditioningFocus         bool       `json:"conditioning_focus"`
	TargetDate                *time.Time `json:"target_date,omitempty"`
	Feasibility               string     `json:"feasibility"`
	FeasibilityWarning        *string    `json:"feasibility_warning,omitempty"`
	Summary                   string     `json:"summary"`
}

type FitnessAssessment struct {
	DistanceMeters    int       `json:"distance_meters"`
	AverageHeartRate  *int      `json:"average_heart_rate,omitempty"`
	PostHeartRate     *int      `json:"post_heart_rate,omitempty"`
	PerceivedExertion int       `json:"perceived_exertion"`
	PerformedAt       time.Time `json:"performed_at"`
}

type OnboardingState struct {
	Profile           *UserProfile        `json:"profile,omitempty"`
	Messages          []OnboardingMessage `json:"messages"`
	Goal              *UserGoal           `json:"goal,omitempty"`
	FitnessAssessment *FitnessAssessment  `json:"fitness_assessment,omitempty"`
	Completed         bool                `json:"completed"`
}

type SaveProfileRequest struct {
	BirthDate             string  `json:"birth_date"`
	HeightCM              float64 `json:"height_cm"`
	CurrentWeightKG       float64 `json:"current_weight_kg"`
	BiologicalSex         *string `json:"biological_sex"`
	InjuriesOrLimitations *string `json:"injuries_or_limitations"`
	TrainingExperience    string  `json:"training_experience"`
}

type ObjectiveMessageRequest struct {
	Message string `json:"message"`
}

type SaveFitnessAssessmentRequest struct {
	DistanceMeters    int  `json:"distance_meters"`
	AverageHeartRate  *int `json:"average_heart_rate"`
	PostHeartRate     *int `json:"post_heart_rate"`
	PerceivedExertion int  `json:"perceived_exertion"`
}

type ObjectiveMessageResponse struct {
	Message   OnboardingMessage `json:"message"`
	Goal      *UserGoal         `json:"goal,omitempty"`
	Completed bool              `json:"completed"`
}
