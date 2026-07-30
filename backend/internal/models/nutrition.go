package models

import "time"

// NutritionPlanInput is the shape both the manual form and the assistant
// produce — the manual path fills it by hand, the assistant fills it from
// the structured generation. Kept separate from NutritionPlan (the read
// model) the same way TrainingPlanInput is kept separate from TrainingPlan.
type NutritionPlanInput struct {
	Name           string                   `json:"name"`
	CaloriesTarget int                      `json:"calories_target"`
	ProteinTarget  float64                  `json:"protein_target"`
	CarbsTarget    float64                  `json:"carbs_target"`
	FatTarget      float64                  `json:"fat_target"`
	Rationale      string                   `json:"rationale"`
	Meals          []NutritionPlanMealInput `json:"meals"`
}

type NutritionPlanMealInput struct {
	MealType    string                       `json:"meal_type"`
	Name        string                       `json:"name"`
	SuggestedAt *string                      `json:"suggested_at"`
	Notes       string                       `json:"notes"`
	Items       []NutritionPlanMealItemInput `json:"items"`
}

type NutritionPlanMealItemInput struct {
	FoodName  string  `json:"food_name"`
	QuantityG float64 `json:"quantity_g"`
	Calories  float64 `json:"calories"`
	ProteinG  float64 `json:"protein_g"`
	CarbsG    float64 `json:"carbs_g"`
	FatG      float64 `json:"fat_g"`
}

// ManualNutritionPlanRequest is what the manual-creation form posts. It is
// intentionally smaller than NutritionPlanInput: a person typing targets by
// hand does not also type a meal-by-meal menu.
type ManualNutritionPlanRequest struct {
	Name           string  `json:"name"`
	CaloriesTarget int     `json:"calories_target"`
	ProteinTarget  float64 `json:"protein_target"`
	CarbsTarget    float64 `json:"carbs_target"`
	FatTarget      float64 `json:"fat_target"`
}

// AutomaticNutritionPlanRequest carries no numeric targets — the assistant
// derives them from the person's profile, goal and training plan.
type AutomaticNutritionPlanRequest struct {
	Preferences string `json:"preferences"`
}

// NutritionPlanJob tracks a plan generation or adjustment running in the
// background, mirroring TrainingPlanJob: the assistant routinely takes
// minutes, far more than a request can be held open.
type NutritionPlanJob struct {
	ID        int64     `json:"id"`
	Kind      string    `json:"kind"`
	Status    string    `json:"status"`
	PlanID    *int64    `json:"plan_id,omitempty"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type CreateFoodItemRequest struct {
	Name            string  `json:"name"`
	Brand           string  `json:"brand"`
	CaloriesPer100g float64 `json:"calories_per_100g"`
	ProteinG        float64 `json:"protein_g"`
	CarbsG          float64 `json:"carbs_g"`
	FatG            float64 `json:"fat_g"`
	FiberG          float64 `json:"fiber_g"`
	SodiumMg        float64 `json:"sodium_mg"`
	ServingLabel    string  `json:"serving_label"`
	ServingGrams    float64 `json:"serving_grams"`
	// PhotoID links the label photo just analyzed as this food's cover.
	PhotoID *int64 `json:"photo_id"`
}

// CreateFoodLogRequest logs an entry either from a catalog/personal food
// (FoodItemID set, macros computed server-side from the food's row) or from
// free text or a photo (FoodItemID nil, macros come pre-computed from the
// review screen — a plate photo estimate or a manually typed entry — since
// there is no catalog row to look them up from).
type CreateFoodLogRequest struct {
	FoodItemID  *int64  `json:"food_item_id"`
	FoodName    string  `json:"food_name"`
	QuantityG   float64 `json:"quantity_g"`
	MealType    string  `json:"meal_type"`
	Date        string  `json:"date"` // YYYY-MM-DD
	Origin      string  `json:"origin"`
	ClientLogID string  `json:"client_log_id"`
	PhotoID     *int64  `json:"photo_id"`
	Calories    float64 `json:"calories"`
	ProteinG    float64 `json:"protein_g"`
	CarbsG      float64 `json:"carbs_g"`
	FatG        float64 `json:"fat_g"`
}

type UpdateFoodLogRequest struct {
	QuantityG float64 `json:"quantity_g"`
	MealType  string  `json:"meal_type"`
}

// MealPhoto is the inventory row for a file written under PhotoDir. Both
// FoodLogID and FoodItemID are optional and ON DELETE SET NULL: deleting the
// diary entry or the food must not orphan the file on disk unnoticed.
type MealPhoto struct {
	ID          int64     `json:"id"`
	UserID      int64     `json:"user_id"`
	FoodLogID   *int64    `json:"food_log_id,omitempty"`
	FoodItemID  *int64    `json:"food_item_id,omitempty"`
	Kind        string    `json:"kind"` // plate, label
	ContentType string    `json:"content_type"`
	ByteSize    int       `json:"byte_size"`
	CreatedAt   time.Time `json:"created_at"`
}

// PlateAnalysis is the assistant's estimate for a photographed plate. Weight
// estimation from a photo is inherently imprecise, so this always lands on a
// review screen the person edits before anything is logged.
type PlateAnalysis struct {
	Items      []PlateAnalysisItem `json:"items"`
	Confidence string              `json:"confidence"` // high, medium, low
	Caveat     string              `json:"caveat"`
}

type PlateAnalysisItem struct {
	FoodName       string  `json:"food_name"`
	EstimatedGrams float64 `json:"estimated_grams"`
	Calories       float64 `json:"calories"`
	ProteinG       float64 `json:"protein_g"`
	CarbsG         float64 `json:"carbs_g"`
	FatG           float64 `json:"fat_g"`
}

// LabelAnalysis is the assistant's reading of a nutrition facts label,
// normalized to per-100g regardless of how the label expressed portions.
type LabelAnalysis struct {
	Name            string  `json:"name"`
	Brand           string  `json:"brand"`
	ServingLabel    string  `json:"serving_label"`
	ServingGrams    float64 `json:"serving_grams"`
	CaloriesPer100g float64 `json:"calories_per_100g"`
	ProteinG        float64 `json:"protein_g"`
	CarbsG          float64 `json:"carbs_g"`
	FatG            float64 `json:"fat_g"`
	FiberG          float64 `json:"fiber_g"`
	SodiumMg        float64 `json:"sodium_mg"`
}

// NutritionSuggestion answers "what should I eat for the rest of the day",
// computed from what is left of today's targets after what was already logged.
type NutritionSuggestion struct {
	RemainingCalories float64  `json:"remaining_calories"`
	RemainingProteinG float64  `json:"remaining_protein_g"`
	RemainingCarbsG   float64  `json:"remaining_carbs_g"`
	RemainingFatG     float64  `json:"remaining_fat_g"`
	Suggestions       []string `json:"suggestions"`
}

// CheatDaySession is the cheat-day conversation and, once accepted, the
// compensation it produced. Only one may be open per user at a time so
// asking for compensation on back-to-back indulgences never stacks plans.
type CheatDaySession struct {
	ID                 int64             `json:"id"`
	Status             string            `json:"status"` // open, accepted, discarded
	HappensOn          string            `json:"happens_on"`
	EstimatedCalories  *int              `json:"estimated_calories,omitempty"`
	Summary            string            `json:"summary,omitempty"`
	CompensationPlanID *int64            `json:"compensation_plan_id,omitempty"`
	Messages           []CheatDayMessage `json:"messages,omitempty"`
	CreatedAt          time.Time         `json:"created_at"`
}

type CheatDayMessage struct {
	ID        int64     `json:"id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

type SendCheatDayMessageRequest struct {
	Content string `json:"content"`
}

// CheatDayCompensation is what the assistant proposes when the person accepts:
// the estimated cost of the indulgence and a training plan to compensate,
// built from the same schema the training-plan assistant uses.
type CheatDayCompensation struct {
	EstimatedCalories int               `json:"estimated_calories"`
	Summary           string            `json:"summary"`
	CompensationPlan  TrainingPlanInput `json:"compensation_plan"`
	ExpiresInDays     int               `json:"expires_in_days"`
}
