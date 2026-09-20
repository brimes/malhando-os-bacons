package services

import (
	"sort"
	"strconv"
	"strings"

	"github.com/mob/backend/internal/models"
)

// minRoutineUniverseDays is the floor on how many distinct logged days the
// person needs before "dia normal" says anything at all. Below it a median
// over 2-3 days would just be whatever was eaten those days, not a routine.
const minRoutineUniverseDays = 4

// routineItemMinFrequency and routineItemMinDays are the two bars an item has
// to clear independently: frequent enough (>=40% of the days that meal was
// logged) AND seen more than once (a single day is not a pattern, no matter
// how small D is). Compared as integers (daysSeen*10 >= consideredDays*4)
// so 2/5 = 40% is never lost to float rounding sitting exactly on the line.
const routineItemMinDays = 2

var mealTypeOrder = []string{"breakfast", "lunch", "dinner", "snack"}

// DistillRoutine turns a set of food_logs — already narrowed by the caller to
// the last 30 distinct days that have at least one log — into the "dia
// normal": for each meal, the items eaten often enough on the days that meal
// was logged, with quantity and macros taken as the median over the days
// they appeared. Pure and deterministic: the same logs always produce the
// same routine, which is the point — it is what lets the API not call an LLM
// for this.
func DistillRoutine(logs []models.FoodLog) models.NutritionRoutine {
	universe := map[string]bool{}
	for _, log := range logs {
		universe[dateOnly(log)] = true
	}
	basedOnDays := len(universe)
	if basedOnDays < minRoutineUniverseDays {
		return models.NutritionRoutine{Enough: false, BasedOnDays: basedOnDays, Meals: []models.NutritionRoutineMeal{}}
	}

	meals := make([]models.NutritionRoutineMeal, 0, len(mealTypeOrder))
	var totalCal, totalProtein, totalCarbs, totalFat float64
	anyItem := false

	for _, mealType := range mealTypeOrder {
		items, mealCalories, ok := distillMeal(logs, mealType)
		if !ok {
			continue
		}
		anyItem = true
		meals = append(meals, models.NutritionRoutineMeal{MealType: mealType, Items: items, Calories: round2(mealCalories)})
		for _, item := range items {
			totalCal += item.Calories
			totalProtein += item.ProteinG
			totalCarbs += item.CarbsG
			totalFat += item.FatG
		}
	}

	if !anyItem {
		return models.NutritionRoutine{Enough: false, BasedOnDays: basedOnDays, Meals: []models.NutritionRoutineMeal{}}
	}

	return models.NutritionRoutine{
		Enough:      true,
		BasedOnDays: basedOnDays,
		Meals:       meals,
		Totals: models.NutritionRoutineTotals{
			Calories: round2(totalCal),
			ProteinG: round2(totalProtein),
			CarbsG:   round2(totalCarbs),
			FatG:     round2(totalFat),
		},
	}
}

type dayAggregate struct {
	quantityG float64
	calories  float64
	proteinG  float64
	carbsG    float64
	fatG      float64
}

// distillMeal narrows logs to mealType, sums same-item entries within a day
// (so "two spoons of rice, twice at lunch" counts as one day's worth of rice
// before the day-to-day comparison), then keeps only the items frequent
// enough across the days that meal was actually logged.
func distillMeal(logs []models.FoodLog, mealType string) ([]models.NutritionRoutineItem, float64, bool) {
	mealDays := map[string]bool{}
	// day -> group key -> aggregate for that day
	perDay := map[string]map[string]*dayAggregate{}
	// group key -> display identity (food_item_id/food_name), from the first log seen
	identity := map[string]struct {
		foodItemID *int64
		foodName   string
	}{}

	for _, log := range logs {
		if log.MealType != mealType {
			continue
		}
		day := dateOnly(log)
		mealDays[day] = true
		key := routineGroupKey(log.FoodItemID, log.FoodName)
		if _, seen := identity[key]; !seen {
			identity[key] = struct {
				foodItemID *int64
				foodName   string
			}{foodItemID: log.FoodItemID, foodName: log.FoodName}
		}
		if perDay[day] == nil {
			perDay[day] = map[string]*dayAggregate{}
		}
		agg := perDay[day][key]
		if agg == nil {
			agg = &dayAggregate{}
			perDay[day][key] = agg
		}
		agg.quantityG += log.QuantityG
		agg.calories += log.Calories
		agg.proteinG += log.ProteinG
		agg.carbsG += log.CarbsG
		agg.fatG += log.FatG
	}

	considered := len(mealDays)
	if considered == 0 {
		return nil, 0, false
	}

	// Invert to key -> the day aggregates it appeared in.
	perItem := map[string][]*dayAggregate{}
	for _, byKey := range perDay {
		for key, agg := range byKey {
			perItem[key] = append(perItem[key], agg)
		}
	}

	items := make([]models.NutritionRoutineItem, 0, len(perItem))
	var mealCalories float64
	for key, aggs := range perItem {
		daysSeen := len(aggs)
		if daysSeen < routineItemMinDays || daysSeen*10 < considered*4 {
			continue
		}

		quantities := make([]float64, len(aggs))
		perGramCal := make([]float64, len(aggs))
		perGramProtein := make([]float64, len(aggs))
		perGramCarbs := make([]float64, len(aggs))
		perGramFat := make([]float64, len(aggs))
		for i, agg := range aggs {
			quantities[i] = agg.quantityG
			if agg.quantityG > 0 {
				perGramCal[i] = agg.calories / agg.quantityG
				perGramProtein[i] = agg.proteinG / agg.quantityG
				perGramCarbs[i] = agg.carbsG / agg.quantityG
				perGramFat[i] = agg.fatG / agg.quantityG
			}
		}

		medianQuantity := median(quantities)
		id := identity[key]
		item := models.NutritionRoutineItem{
			FoodItemID:     id.foodItemID,
			FoodName:       id.foodName,
			QuantityG:      round2(medianQuantity),
			Calories:       round2(median(perGramCal) * medianQuantity),
			ProteinG:       round2(median(perGramProtein) * medianQuantity),
			CarbsG:         round2(median(perGramCarbs) * medianQuantity),
			FatG:           round2(median(perGramFat) * medianQuantity),
			DaysSeen:       daysSeen,
			DaysConsidered: considered,
		}
		items = append(items, item)
		mealCalories += item.Calories
	}

	if len(items) == 0 {
		return nil, 0, false
	}

	// Deterministic order: the map walk above is not, so a repeat call over
	// the same logs must still land on the same array order. Highest calories
	// first (what dominates the meal), name as the tie-break.
	sort.Slice(items, func(i, j int) bool {
		if items[i].Calories != items[j].Calories {
			return items[i].Calories > items[j].Calories
		}
		return items[i].FoodName < items[j].FoodName
	})

	return items, mealCalories, true
}

func dateOnly(log models.FoodLog) string {
	return log.Date.Format("2006-01-02")
}

// routineGroupKey mirrors groupKeyFor in handlers/nutrition_favorites.go
// (food_item_id when there is one, else the normalized name) so the same
// food groups identically here as it does in the "+ Log" history and
// favorites. Kept as its own copy — this package cannot import handlers
// without an import cycle — with the same "item:"/"name:" prefixes so a key
// printed while debugging one reads like the other.
func routineGroupKey(foodItemID *int64, foodName string) string {
	if foodItemID != nil {
		return "item:" + strconv.FormatInt(*foodItemID, 10)
	}
	return "name:" + normalizeRoutineFoodName(foodName)
}

// normalizeRoutineFoodName mirrors normalizeSearchText in
// handlers/nutrition_foods.go (itself matching migration 017's SQL
// translate()) character-for-character, so "Arroz" and "arroz" — or an
// accented and unaccented spelling logged on different days — group as the
// same routine item.
func normalizeRoutineFoodName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		b.WriteRune(foldRoutineAccent(r))
	}
	return strings.TrimSpace(b.String())
}

func foldRoutineAccent(r rune) rune {
	switch {
	case strings.ContainsRune("áàâãä", r):
		return 'a'
	case strings.ContainsRune("éèêë", r):
		return 'e'
	case strings.ContainsRune("íìîï", r):
		return 'i'
	case strings.ContainsRune("óòôõö", r):
		return 'o'
	case strings.ContainsRune("úùûü", r):
		return 'u'
	case r == 'ç':
		return 'c'
	default:
		return r
	}
}

// median assumes nothing about input order and never mutates the caller's
// slice. Even-length inputs average the two middle values, same as the
// everyday definition.
func median(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	if len(sorted)%2 == 1 {
		return sorted[mid]
	}
	return (sorted[mid-1] + sorted[mid]) / 2
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}
