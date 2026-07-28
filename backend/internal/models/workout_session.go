package models

// StartWorkoutRequest opens a guided session for one day of a training plan.
type StartWorkoutRequest struct {
	TrainingPlanDayID int64 `json:"training_plan_day_id"`
}

// CompleteSetRequest records one finished series. Weight is kept on the series
// itself for history, and echoed onto the plan exercise as next time's suggestion.
type CompleteSetRequest struct {
	TrainingPlanExerciseID *int64  `json:"training_plan_exercise_id"`
	ExerciseName           string  `json:"exercise_name"`
	SetNumber              int     `json:"set_number"`
	Reps                   int     `json:"reps"`
	WeightKg               float64 `json:"weight_kg"`
	TrackingType           string  `json:"tracking_type"`
	DurationSeconds        *int    `json:"duration_seconds"`
}

// CompleteWorkoutRequest closes a session in one shot from a checklist, topping
// each exercise up to the number of series the user marked as done. It serves
// both the quick log (never entered the guided mode) and finishing a guided
// session early with whatever is already ticked.
type CompleteWorkoutRequest struct {
	Notes     string                    `json:"notes"`
	Exercises []CompleteWorkoutExercise `json:"exercises"`
}

type CompleteWorkoutExercise struct {
	TrainingPlanExerciseID int64   `json:"training_plan_exercise_id"`
	SetsDone               int     `json:"sets_done"`
	WeightKg               float64 `json:"weight_kg"`
}

// ActiveWorkout is everything the guided screen needs to render or resume:
// the open workout, the planned exercises, and the series already done.
type ActiveWorkout struct {
	Workout   Workout                `json:"workout"`
	PlanID    *int64                 `json:"plan_id,omitempty"`
	DayName   string                 `json:"day_name"`
	Exercises []TrainingPlanExercise `json:"exercises"`
}

// TrainingSettings holds the guided session preferences shown in the settings screen.
type TrainingSettings struct {
	CountdownSeconds int  `json:"countdown_seconds"`
	VibrationEnabled bool `json:"vibration_enabled"`
	AutoAdvance      bool `json:"auto_advance"`
}
