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
	ID                int64      `json:"id"`
	UserID            int64      `json:"user_id"`
	Name              string     `json:"name"`
	Date              time.Time  `json:"date"`
	Notes             string     `json:"notes,omitempty"`
	TrainingPlanDayID *int64     `json:"training_plan_day_id,omitempty"`
	DurationMinutes   *int       `json:"duration_minutes,omitempty"`
	Status            string     `json:"status"`
	StartedAt         *time.Time `json:"started_at,omitempty"`
	FinishedAt        *time.Time `json:"finished_at,omitempty"`
	// ClientSessionID is the identity the app minted when the session was started
	// offline. It is echoed back so the app can match the workout it built
	// locally with the one the server returned, and swap the local id for the
	// real one in the requests still queued.
	ClientSessionID *string      `json:"client_session_id,omitempty"`
	Sets            []WorkoutSet `json:"sets,omitempty"`
	// SetCount is filled by the list query so the history can show how much was
	// done without loading every set.
	SetCount  int       `json:"set_count,omitempty"`
	CreatedAt time.Time `json:"created_at"`
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
	// ClientSetID is the idempotency key the app sent when logging this series
	// offline, if any. Rows created online carry no key.
	ClientSetID *string `json:"client_set_id,omitempty"`
}

// FoodItem is either a catalog row shared by everyone (UserID nil) or a
// personal food someone registered by hand or by photo (UserID set).
type FoodItem struct {
	ID              int64    `json:"id"`
	UserID          *int64   `json:"user_id,omitempty"`
	Name            string   `json:"name"`
	Brand           string   `json:"brand,omitempty"`
	CaloriesPer100g float64  `json:"calories_per_100g"`
	ProteinG        float64  `json:"protein_g"`
	CarbsG          float64  `json:"carbs_g"`
	FatG            float64  `json:"fat_g"`
	FiberG          float64  `json:"fiber_g"`
	SodiumMg        float64  `json:"sodium_mg"`
	ServingLabel    string   `json:"serving_label,omitempty"`
	ServingGrams    *float64 `json:"serving_grams,omitempty"`
	Source          string   `json:"source,omitempty"`
	Archived        bool     `json:"archived"`
	// CoverPhotoID is the label photo used as this food's cover, if any.
	CoverPhotoID *int64    `json:"cover_photo_id,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type NutritionPlan struct {
	ID             int64               `json:"id"`
	UserID         int64               `json:"user_id"`
	Name           string              `json:"name"`
	CaloriesTarget int                 `json:"calories_target"`
	ProteinTarget  float64             `json:"protein_target"`
	CarbsTarget    float64             `json:"carbs_target"`
	FatTarget      float64             `json:"fat_target"`
	Rationale      string              `json:"rationale,omitempty"`
	CreationMethod string              `json:"creation_method"`
	TrainingPlanID *int64              `json:"training_plan_id,omitempty"`
	Active         bool                `json:"active"`
	Meals          []NutritionPlanMeal `json:"meals,omitempty"`
	CreatedAt      time.Time           `json:"created_at"`
}

type NutritionPlanMeal struct {
	ID          int64                   `json:"id"`
	MealOrder   int                     `json:"meal_order"`
	MealType    string                  `json:"meal_type"`
	Name        string                  `json:"name"`
	SuggestedAt *string                 `json:"suggested_at,omitempty"` // "HH:MM"
	Notes       string                  `json:"notes,omitempty"`
	Items       []NutritionPlanMealItem `json:"items"`
}

type NutritionPlanMealItem struct {
	ID         int64   `json:"id"`
	ItemOrder  int     `json:"item_order"`
	FoodItemID *int64  `json:"food_item_id,omitempty"`
	FoodName   string  `json:"food_name"`
	QuantityG  float64 `json:"quantity_g"`
	Calories   float64 `json:"calories"`
	ProteinG   float64 `json:"protein_g"`
	CarbsG     float64 `json:"carbs_g"`
	FatG       float64 `json:"fat_g"`
}

// FoodLog snapshots the macros at the moment it was logged, so correcting a
// catalog food later never rewrites history — the same principle behind
// workout_sets storing the weight used instead of a live reference.
type FoodLog struct {
	ID         int64     `json:"id"`
	UserID     int64     `json:"user_id"`
	FoodItemID *int64    `json:"food_item_id,omitempty"`
	FoodItem   *FoodItem `json:"food_item,omitempty"`
	FoodName   string    `json:"food_name"`
	MealType   string    `json:"meal_type"` // breakfast, lunch, dinner, snack
	QuantityG  float64   `json:"quantity_g"`
	Calories   float64   `json:"calories"`
	ProteinG   float64   `json:"protein_g"`
	CarbsG     float64   `json:"carbs_g"`
	FatG       float64   `json:"fat_g"`
	Origin     string    `json:"origin"`
	// ClientLogID is the idempotency key the app sent when logging this entry
	// offline, if any. Rows created online carry no key.
	ClientLogID *string   `json:"client_log_id,omitempty"`
	PhotoID     *int64    `json:"photo_id,omitempty"`
	Date        time.Time `json:"date"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
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
