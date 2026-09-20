package services

import (
	"testing"
	"time"

	"github.com/mob/backend/internal/models"
)

func mustDate(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := time.Parse("2006-01-02", s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func itemPtr(id int64) *int64 { return &id }

// log builds a food_logs row with per-gram macros chosen so the expected
// median is easy to hand-check: calories/protein/carbs/fat are always
// quantityG * a fixed per-gram ratio, so whatever quantity the median picks,
// the macros must scale by the same ratio.
func log(t *testing.T, date, mealType string, foodItemID *int64, name string, quantityG, calPerG, proteinPerG, carbsPerG, fatPerG float64) models.FoodLog {
	return models.FoodLog{
		Date:       mustDate(t, date),
		MealType:   mealType,
		FoodItemID: foodItemID,
		FoodName:   name,
		QuantityG:  quantityG,
		Calories:   quantityG * calPerG,
		ProteinG:   quantityG * proteinPerG,
		CarbsG:     quantityG * carbsPerG,
		FatG:       quantityG * fatPerG,
	}
}

func findMeal(t *testing.T, routine models.NutritionRoutine, mealType string) models.NutritionRoutineMeal {
	t.Helper()
	for _, m := range routine.Meals {
		if m.MealType == mealType {
			return m
		}
	}
	t.Fatalf("meal %q not in routine: %+v", mealType, routine.Meals)
	return models.NutritionRoutineMeal{}
}

func findItem(t *testing.T, meal models.NutritionRoutineMeal, name string) models.NutritionRoutineItem {
	t.Helper()
	for _, i := range meal.Items {
		if i.FoodName == name {
			return i
		}
	}
	t.Fatalf("item %q not in meal %q: %+v", name, meal.MealType, meal.Items)
	return models.NutritionRoutineItem{}
}

func almostEqual(a, b float64) bool {
	diff := a - b
	if diff < 0 {
		diff = -diff
	}
	return diff < 0.01
}

// TestDistillRoutine_NotEnoughHistory covers the "universe < 4 distinct
// days" rule: fewer days logged than that, and the routine must refuse to
// answer rather than build a median out of two or three data points.
func TestDistillRoutine_NotEnoughHistory(t *testing.T) {
	logs := []models.FoodLog{
		log(t, "2026-09-01", "breakfast", nil, "Ovo", 100, 1.3, 0.1, 0.05, 0.08),
		log(t, "2026-09-02", "breakfast", nil, "Ovo", 100, 1.3, 0.1, 0.05, 0.08),
		log(t, "2026-09-03", "breakfast", nil, "Ovo", 100, 1.3, 0.1, 0.05, 0.08),
	}
	routine := DistillRoutine(logs)
	if routine.Enough {
		t.Fatalf("expected not enough with 3 distinct days, got enough=true")
	}
	if routine.BasedOnDays != 3 {
		t.Fatalf("expected based_on_days=3, got %d", routine.BasedOnDays)
	}
	if len(routine.Meals) != 0 {
		t.Fatalf("expected no meals when not enough, got %+v", routine.Meals)
	}
}

// TestDistillRoutine_NothingQualifies checks that enough history with no
// consistent item (a different food every day) also comes back empty instead
// of forcing something into the routine.
func TestDistillRoutine_NothingQualifies(t *testing.T) {
	logs := []models.FoodLog{
		log(t, "2026-09-01", "breakfast", nil, "Ovo", 100, 1, 1, 1, 1),
		log(t, "2026-09-02", "breakfast", nil, "Tapioca", 100, 1, 1, 1, 1),
		log(t, "2026-09-03", "breakfast", nil, "Pão", 100, 1, 1, 1, 1),
		log(t, "2026-09-04", "breakfast", nil, "Aveia", 100, 1, 1, 1, 1),
	}
	routine := DistillRoutine(logs)
	if routine.Enough {
		t.Fatalf("expected enough=false when nothing repeats, got true (%+v)", routine.Meals)
	}
	if routine.BasedOnDays != 4 {
		t.Fatalf("expected based_on_days=4, got %d", routine.BasedOnDays)
	}
	if len(routine.Meals) != 0 {
		t.Fatalf("expected no meals, got %+v", routine.Meals)
	}
}

// TestDistillRoutine_QualifiesAndComputesMedians is the main case: five
// days, an item every day at breakfast, two items at lunch splitting the
// week (one at exactly the 40% boundary), and a one-off dinner item that
// must never qualify no matter its 100% rate within its own single day.
func TestDistillRoutine_QualifiesAndComputesMedians(t *testing.T) {
	var logs []models.FoodLog

	// Breakfast: "Ovo" every day, quantities [100,120,80,90,110] -> median 100.
	ovoQuantities := []float64{100, 120, 80, 90, 110}
	days := []string{"2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"}
	for i, d := range days {
		logs = append(logs, log(t, d, "breakfast", nil, "Ovo", ovoQuantities[i], 1.3, 0.1, 0.05, 0.08))
	}

	// Lunch: every day has *some* lunch log (so days_considered=5).
	// "Arroz" on days 1-3 (60%, quantities [100,150,200] -> median 150).
	arrozQuantities := []float64{100, 150, 200}
	for i := 0; i < 3; i++ {
		logs = append(logs, log(t, days[i], "lunch", nil, "Arroz", arrozQuantities[i], 1.0, 0.08, 0.2, 0.01))
	}
	// "Feijão" on days 4-5 (exactly 40%, the boundary — must still qualify).
	feijaoQuantities := []float64{50, 70}
	for i := 0; i < 2; i++ {
		logs = append(logs, log(t, days[3+i], "lunch", nil, "Feijão", feijaoQuantities[i], 1.2, 0.15, 0.25, 0.02))
	}

	// Dinner: "Suco" appears only once, its one day at 100% frequency — the
	// >=2-days floor must still exclude it.
	logs = append(logs, log(t, days[0], "dinner", nil, "Suco", 200, 0.4, 0, 0.1, 0))

	routine := DistillRoutine(logs)
	if !routine.Enough {
		t.Fatalf("expected enough=true, got false (based_on_days=%d)", routine.BasedOnDays)
	}
	if routine.BasedOnDays != 5 {
		t.Fatalf("expected based_on_days=5, got %d", routine.BasedOnDays)
	}

	breakfast := findMeal(t, routine, "breakfast")
	if len(breakfast.Items) != 1 {
		t.Fatalf("expected exactly 1 breakfast item, got %+v", breakfast.Items)
	}
	ovo := findItem(t, breakfast, "Ovo")
	if !almostEqual(ovo.QuantityG, 100) || !almostEqual(ovo.Calories, 130) ||
		!almostEqual(ovo.ProteinG, 10) || !almostEqual(ovo.CarbsG, 5) || !almostEqual(ovo.FatG, 8) {
		t.Fatalf("unexpected Ovo item: %+v", ovo)
	}
	if ovo.DaysSeen != 5 || ovo.DaysConsidered != 5 {
		t.Fatalf("unexpected Ovo day counts: %+v", ovo)
	}

	lunch := findMeal(t, routine, "lunch")
	if len(lunch.Items) != 2 {
		t.Fatalf("expected exactly 2 lunch items (Arroz, Feijão), got %+v", lunch.Items)
	}
	arroz := findItem(t, lunch, "Arroz")
	if !almostEqual(arroz.QuantityG, 150) || !almostEqual(arroz.Calories, 150) ||
		!almostEqual(arroz.ProteinG, 12) || !almostEqual(arroz.CarbsG, 30) || !almostEqual(arroz.FatG, 1.5) {
		t.Fatalf("unexpected Arroz item: %+v", arroz)
	}
	if arroz.DaysSeen != 3 || arroz.DaysConsidered != 5 {
		t.Fatalf("unexpected Arroz day counts: %+v", arroz)
	}
	feijao := findItem(t, lunch, "Feijão")
	if !almostEqual(feijao.QuantityG, 60) || !almostEqual(feijao.Calories, 72) ||
		!almostEqual(feijao.ProteinG, 9) || !almostEqual(feijao.CarbsG, 15) || !almostEqual(feijao.FatG, 1.2) {
		t.Fatalf("unexpected Feijão item (40%% boundary): %+v", feijao)
	}
	if feijao.DaysSeen != 2 || feijao.DaysConsidered != 5 {
		t.Fatalf("unexpected Feijão day counts: %+v", feijao)
	}
	// Highest-calories-first ordering.
	if lunch.Items[0].FoodName != "Arroz" || lunch.Items[1].FoodName != "Feijão" {
		t.Fatalf("expected Arroz before Feijão by calories, got order %v", []string{lunch.Items[0].FoodName, lunch.Items[1].FoodName})
	}

	for _, m := range routine.Meals {
		if m.MealType == "dinner" {
			t.Fatalf("dinner should have no qualifying item (Suco seen only once), got %+v", m)
		}
	}

	expectedTotalCal := ovo.Calories + arroz.Calories + feijao.Calories
	if !almostEqual(routine.Totals.Calories, expectedTotalCal) {
		t.Fatalf("expected totals.calories=%.2f, got %.2f", expectedTotalCal, routine.Totals.Calories)
	}
}

// TestDistillRoutine_GroupsByFoodItemID checks that two logs sharing a
// food_item_id group together even when their free-text name differs (a food
// renamed in the catalog between logs) — the id must win over the name.
func TestDistillRoutine_GroupsByFoodItemID(t *testing.T) {
	id := itemPtr(42)
	logs := []models.FoodLog{
		log(t, "2026-09-01", "snack", id, "Whey", 30, 4, 0.8, 0.1, 0.05),
		log(t, "2026-09-02", "snack", id, "Whey Protein", 30, 4, 0.8, 0.1, 0.05),
		log(t, "2026-09-03", "snack", id, "Whey", 30, 4, 0.8, 0.1, 0.05),
		log(t, "2026-09-04", "snack", id, "Whey", 30, 4, 0.8, 0.1, 0.05),
	}
	routine := DistillRoutine(logs)
	if !routine.Enough {
		t.Fatalf("expected enough=true, got false")
	}
	snack := findMeal(t, routine, "snack")
	if len(snack.Items) != 1 {
		t.Fatalf("expected the id-linked logs to group into 1 item, got %+v", snack.Items)
	}
	if snack.Items[0].DaysSeen != 4 {
		t.Fatalf("expected days_seen=4, got %d", snack.Items[0].DaysSeen)
	}
	if snack.Items[0].FoodItemID == nil || *snack.Items[0].FoodItemID != 42 {
		t.Fatalf("expected food_item_id=42, got %+v", snack.Items[0].FoodItemID)
	}
}
