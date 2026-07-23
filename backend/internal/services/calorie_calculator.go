package services

import "math"

type UserProfile struct {
	WeightKg float64
	HeightCm float64
	AgeYears int
	Gender   string // "male" or "female"
	ActivityLevel string // sedentary, light, moderate, active, very_active
}

// CalculateBMR calculates Basal Metabolic Rate using Mifflin-St Jeor equation
func CalculateBMR(p UserProfile) float64 {
	var bmr float64
	if p.Gender == "male" {
		bmr = 10*p.WeightKg + 6.25*p.HeightCm - 5*float64(p.AgeYears) + 5
	} else {
		bmr = 10*p.WeightKg + 6.25*p.HeightCm - 5*float64(p.AgeYears) - 161
	}
	return bmr
}

// CalculateTDEE calculates Total Daily Energy Expenditure
func CalculateTDEE(p UserProfile) float64 {
	bmr := CalculateBMR(p)

	activityMultipliers := map[string]float64{
		"sedentary":    1.2,
		"light":        1.375,
		"moderate":     1.55,
		"active":       1.725,
		"very_active":  1.9,
	}

	multiplier, ok := activityMultipliers[p.ActivityLevel]
	if !ok {
		multiplier = 1.55 // default to moderate
	}

	return math.Round(bmr * multiplier)
}

// CaloriesFromMacros calculates total calories from macronutrients
func CaloriesFromMacros(proteinG, carbsG, fatG float64) float64 {
	return proteinG*4 + carbsG*4 + fatG*9
}

// StepsToCalories estimates calories burned from steps
func StepsToCalories(steps int, weightKg float64) float64 {
	// Approximate: 0.04 calories per step per kg bodyweight / 70
	stepsPerKm := 1312.0
	kmWalked := float64(steps) / stepsPerKm
	// MET value for walking ~3.5
	metValue := 3.5
	caloriesPerKm := metValue * weightKg * (kmWalked / 60.0) * 60.0
	return math.Round(caloriesPerKm*100) / 100
}

// MacroTargetsFromCalories calculates macro targets given calorie goal and body goal
func MacroTargetsFromCalories(calories float64, goal string) (proteinG, carbsG, fatG float64) {
	switch goal {
	case "muscle_gain":
		// High protein: 30% protein, 45% carbs, 25% fat
		proteinG = (calories * 0.30) / 4
		carbsG = (calories * 0.45) / 4
		fatG = (calories * 0.25) / 9
	case "fat_loss":
		// High protein, low carb: 35% protein, 30% carbs, 35% fat
		proteinG = (calories * 0.35) / 4
		carbsG = (calories * 0.30) / 4
		fatG = (calories * 0.35) / 9
	default: // maintenance
		// Balanced: 25% protein, 50% carbs, 25% fat
		proteinG = (calories * 0.25) / 4
		carbsG = (calories * 0.50) / 4
		fatG = (calories * 0.25) / 9
	}
	return math.Round(proteinG), math.Round(carbsG), math.Round(fatG)
}
