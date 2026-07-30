package services

import "math"

// This file used to define its own UserProfile with a Gender field
// ("male"/"female", colliding with models.UserProfile's BiologicalSex) and an
// ActivityLevel that never existed as a database column, plus goal strings
// ("muscle_gain", "fat_loss") that never matched the real
// user_goals.goal_type enum (lose_weight, gain_muscle, recomposition,
// maintain, other). None of it was ever called from anywhere. It is rewritten
// here to match the real schema, because it is now load-bearing: it is the
// deterministic check the nutrition assistant's output is validated against,
// not just a nice-to-have estimate.

// EnergyProfile is the subset of a person's data the calorie math needs.
type EnergyProfile struct {
	WeightKg      float64
	HeightCm      float64
	AgeYears      int
	BiologicalSex string // "male" or "female"; unknown defaults to female's more conservative BMR
}

// CalculateBMR computes Basal Metabolic Rate with Mifflin-St Jeor.
func CalculateBMR(p EnergyProfile) float64 {
	base := 10*p.WeightKg + 6.25*p.HeightCm - 5*float64(p.AgeYears)
	if p.BiologicalSex == "male" {
		return base + 5
	}
	return base - 161
}

// ActivityMultiplierForTrainingDays derives an activity level from how many
// days a week the person's active training plan schedules, since there is no
// ActivityLevel column anywhere in the schema to read one from directly.
func ActivityMultiplierForTrainingDays(daysPerWeek int) float64 {
	switch {
	case daysPerWeek <= 0:
		return 1.2 // sedentary
	case daysPerWeek <= 2:
		return 1.375 // light
	case daysPerWeek <= 4:
		return 1.55 // moderate
	case daysPerWeek <= 6:
		return 1.725 // active
	default:
		return 1.9 // very active
	}
}

// CalculateTDEE computes Total Daily Energy Expenditure.
func CalculateTDEE(p EnergyProfile, daysPerWeek int) float64 {
	return math.Round(CalculateBMR(p) * ActivityMultiplierForTrainingDays(daysPerWeek))
}

// CaloriesFromMacros converts macros to calories at 4/4/9 kcal per gram.
func CaloriesFromMacros(proteinG, carbsG, fatG float64) float64 {
	return proteinG*4 + carbsG*4 + fatG*9
}

// MinimumSafeCalories is the absolute floor below which a plan is rejected
// outright, regardless of what the assistant or the TDEE math suggests. No
// prompt reliably holds this line on its own; the check has to be code.
func MinimumSafeCalories(biologicalSex string) int {
	if biologicalSex == "male" {
		return 1500
	}
	return 1200
}

// CaloriesTargetWithinRange reports whether a proposed calorie target is a
// plausible deficit/surplus around TDEE (60%-150%) and above the absolute
// floor. Anything outside this is not a diet, it is a red flag.
func CaloriesTargetWithinRange(target int, tdee float64, biologicalSex string) bool {
	if target < MinimumSafeCalories(biologicalSex) {
		return false
	}
	low := tdee * 0.60
	high := tdee * 1.50
	return float64(target) >= low && float64(target) <= high
}

// MacroTargetsFromCalories splits a calorie target into macro grams by goal,
// using the real goal_type enum (lose_weight, gain_muscle, recomposition,
// maintain, other).
func MacroTargetsFromCalories(calories float64, goalType string) (proteinG, carbsG, fatG float64) {
	switch goalType {
	case "gain_muscle":
		proteinG = (calories * 0.30) / 4
		carbsG = (calories * 0.45) / 4
		fatG = (calories * 0.25) / 9
	case "lose_weight":
		proteinG = (calories * 0.35) / 4
		carbsG = (calories * 0.30) / 4
		fatG = (calories * 0.35) / 9
	case "recomposition":
		proteinG = (calories * 0.35) / 4
		carbsG = (calories * 0.35) / 4
		fatG = (calories * 0.30) / 9
	default: // maintain, other
		proteinG = (calories * 0.25) / 4
		carbsG = (calories * 0.50) / 4
		fatG = (calories * 0.25) / 9
	}
	return math.Round(proteinG), math.Round(carbsG), math.Round(fatG)
}
