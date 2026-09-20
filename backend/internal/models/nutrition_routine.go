package models

// NutritionRoutine is the "dia normal" distilled deterministically from the
// person's own history (see services.DistillRoutine) — no LLM involved, so
// the same food_logs always produce the same answer. Enough is false when
// there is not enough history yet, or when nothing in it is consistent
// enough to call routine; Meals is empty either way.
type NutritionRoutine struct {
	Enough      bool                   `json:"enough"`
	BasedOnDays int                    `json:"based_on_days"`
	Meals       []NutritionRoutineMeal `json:"meals"`
	Totals      NutritionRoutineTotals `json:"totals"`
}

type NutritionRoutineMeal struct {
	MealType string                 `json:"meal_type"`
	Items    []NutritionRoutineItem `json:"items"`
	Calories float64                `json:"calories"`
}

// NutritionRoutineItem is one food that qualified for the routine: it showed
// up in DaysSeen of the DaysConsidered days that had that meal logged at all,
// past the 40%-and-at-least-2-days bar. QuantityG and the macros are medians
// over the days it appeared, not a recomputation from the food catalog — the
// historical log is the source of truth (a food_items row can be edited
// later without rewriting what was actually eaten).
type NutritionRoutineItem struct {
	FoodItemID     *int64  `json:"food_item_id,omitempty"`
	FoodName       string  `json:"food_name"`
	QuantityG      float64 `json:"quantity_g"`
	Calories       float64 `json:"calories"`
	ProteinG       float64 `json:"protein_g"`
	CarbsG         float64 `json:"carbs_g"`
	FatG           float64 `json:"fat_g"`
	DaysSeen       int     `json:"days_seen"`
	DaysConsidered int     `json:"days_considered"`
}

type NutritionRoutineTotals struct {
	Calories float64 `json:"calories"`
	ProteinG float64 `json:"protein_g"`
	CarbsG   float64 `json:"carbs_g"`
	FatG     float64 `json:"fat_g"`
}

// MissingDaysResponse is what GET /api/nutrition/missing-days answers.
type MissingDaysResponse struct {
	Days []string `json:"days"`
}
