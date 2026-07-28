package models

import "time"

type User struct {
	ID        int64     `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	GoogleID  *string   `json:"google_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type Workout struct {
	ID                int64        `json:"id"`
	UserID            int64        `json:"user_id"`
	Name              string       `json:"name"`
	Date              time.Time    `json:"date"`
	Notes             string       `json:"notes,omitempty"`
	TrainingPlanDayID *int64       `json:"training_plan_day_id,omitempty"`
	DurationMinutes   *int         `json:"duration_minutes,omitempty"`
	Status            string       `json:"status"`
	StartedAt         *time.Time   `json:"started_at,omitempty"`
	FinishedAt        *time.Time   `json:"finished_at,omitempty"`
	Sets              []WorkoutSet `json:"sets,omitempty"`
	CreatedAt         time.Time    `json:"created_at"`
}

type WorkoutSet struct {
	ID                     int64      `json:"id"`
	WorkoutID              int64      `json:"workout_id"`
	ExerciseName           string     `json:"exercise_name"`
	Sets                   int        `json:"sets"`
	Reps                   int        `json:"reps"`
	TrackingType           string     `json:"tracking_type"`
	DurationSeconds        *int       `json:"duration_seconds,omitempty"`
	WeightKg               float64    `json:"weight_kg"`
	TrainingPlanExerciseID *int64     `json:"training_plan_exercise_id,omitempty"`
	SetNumber              *int       `json:"set_number,omitempty"`
	CompletedAt            *time.Time `json:"completed_at,omitempty"`
	CreatedAt              time.Time  `json:"created_at"`
}

type FoodItem struct {
	ID              int64   `json:"id"`
	Name            string  `json:"name"`
	CaloriesPer100g float64 `json:"calories_per_100g"`
	ProteinG        float64 `json:"protein_g"`
	CarbsG          float64 `json:"carbs_g"`
	FatG            float64 `json:"fat_g"`
	Source          string  `json:"source,omitempty"`
}

type NutritionPlan struct {
	ID             int64   `json:"id"`
	UserID         int64   `json:"user_id"`
	Name           string  `json:"name"`
	CaloriesTarget int     `json:"calories_target"`
	ProteinTarget  float64 `json:"protein_target"`
	CarbsTarget    float64 `json:"carbs_target"`
	FatTarget      float64 `json:"fat_target"`
	Active         bool    `json:"active"`
}

type FoodLog struct {
	ID         int64     `json:"id"`
	UserID     int64     `json:"user_id"`
	FoodItemID int64     `json:"food_item_id"`
	FoodItem   *FoodItem `json:"food_item,omitempty"`
	MealType   string    `json:"meal_type"` // breakfast, lunch, dinner, snack
	QuantityG  float64   `json:"quantity_g"`
	Date       time.Time `json:"date"`
	CreatedAt  time.Time `json:"created_at"`
	// Computed fields
	Calories float64 `json:"calories,omitempty"`
	ProteinG float64 `json:"protein_g,omitempty"`
	CarbsG   float64 `json:"carbs_g,omitempty"`
	FatG     float64 `json:"fat_g,omitempty"`
}

type Steps struct {
	ID             int64     `json:"id"`
	UserID         int64     `json:"user_id"`
	Date           time.Time `json:"date"`
	Count          int       `json:"count"`
	CaloriesBurned float64   `json:"calories_burned"`
	Source         string    `json:"source"` // galaxy_watch, manual
}

// Request/Response types

type GoogleAuthRequest struct {
	IDToken string `json:"id_token"`
}

type RegisterRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type CreateWorkoutRequest struct {
	Name              string            `json:"name"`
	Date              time.Time         `json:"date"`
	Notes             string            `json:"notes,omitempty"`
	TrainingPlanDayID *int64            `json:"training_plan_day_id,omitempty"`
	DurationMinutes   *int              `json:"duration_minutes,omitempty"`
	Sets              []WorkoutSetInput `json:"sets,omitempty"`
}

type WorkoutSetInput struct {
	ExerciseName    string  `json:"exercise_name"`
	Sets            int     `json:"sets"`
	Reps            int     `json:"reps"`
	TrackingType    string  `json:"tracking_type"`
	DurationSeconds *int    `json:"duration_seconds,omitempty"`
	WeightKg        float64 `json:"weight_kg"`
}

type WorkoutStats struct {
	TotalWorkouts     int     `json:"total_workouts"`
	WorkoutsThisWeek  int     `json:"workouts_this_week"`
	WorkoutsThisMonth int     `json:"workouts_this_month"`
	TotalSets         int     `json:"total_sets"`
	TotalVolume       float64 `json:"total_volume_kg"`
	Streak            int     `json:"streak_days"`
}

type CreateNutritionPlanRequest struct {
	Name           string  `json:"name"`
	CaloriesTarget int     `json:"calories_target"`
	ProteinTarget  float64 `json:"protein_target"`
	CarbsTarget    float64 `json:"carbs_target"`
	FatTarget      float64 `json:"fat_target"`
}

type CreateFoodLogRequest struct {
	FoodItemID int64   `json:"food_item_id"`
	MealType   string  `json:"meal_type"`
	QuantityG  float64 `json:"quantity_g"`
	Date       string  `json:"date"` // YYYY-MM-DD
}

type SyncStepsRequest struct {
	Date           string  `json:"date"` // YYYY-MM-DD
	Count          int     `json:"count"`
	CaloriesBurned float64 `json:"calories_burned"`
	Source         string  `json:"source"`
}

type DashboardResponse struct {
	User           User             `json:"user"`
	TodayWorkout   *Workout         `json:"today_workout,omitempty"`
	WorkoutStats   WorkoutStats     `json:"workout_stats"`
	TodayNutrition NutritionSummary `json:"today_nutrition"`
	ActivePlan     *NutritionPlan   `json:"active_plan,omitempty"`
	TodaySteps     *Steps           `json:"today_steps,omitempty"`
	WeeklyWorkouts []Workout        `json:"weekly_workouts"`
	// NextWorkout is the plan day due next. It is returned even when today's
	// workout is already done — the home screen decides what to show.
	NextWorkout *NextWorkout `json:"next_workout,omitempty"`
	// DaysSinceLastWorkout is nil when no workout was ever completed.
	DaysSinceLastWorkout *int               `json:"days_since_last_workout,omitempty"`
	WeeklyPerformance    *WeeklyPerformance `json:"weekly_performance,omitempty"`
}

type NutritionSummary struct {
	Calories float64   `json:"calories"`
	ProteinG float64   `json:"protein_g"`
	CarbsG   float64   `json:"carbs_g"`
	FatG     float64   `json:"fat_g"`
	Logs     []FoodLog `json:"logs,omitempty"`
}
