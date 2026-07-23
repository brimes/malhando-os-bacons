package services

import (
	"context"
	"fmt"
	"time"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/models"
)

type NutritionService struct {
	db *db.DB
}

func NewNutritionService(database *db.DB) *NutritionService {
	return &NutritionService{db: database}
}

type DailyNutrition struct {
	Date     time.Time `json:"date"`
	Calories float64   `json:"calories"`
	ProteinG float64   `json:"protein_g"`
	CarbsG   float64   `json:"carbs_g"`
	FatG     float64   `json:"fat_g"`
}

// GetDailyNutritionSummary returns nutrition totals for a specific day
func (s *NutritionService) GetDailyNutritionSummary(ctx context.Context, userID int64, date time.Time) (*models.NutritionSummary, error) {
	rows, err := s.db.Pool.Query(ctx,
		`SELECT fl.id, fl.user_id, fl.food_item_id, fl.meal_type, fl.quantity_g, fl.date, fl.created_at,
		        fi.id, fi.name, fi.calories_per_100g, fi.protein_g, fi.carbs_g, fi.fat_g, COALESCE(fi.source,'')
		 FROM food_logs fl
		 JOIN food_items fi ON fi.id = fl.food_item_id
		 WHERE fl.user_id = $1 AND fl.date::date = $2::date
		 ORDER BY fl.meal_type, fl.created_at`,
		userID, date,
	)
	if err != nil {
		return nil, fmt.Errorf("query food logs: %w", err)
	}
	defer rows.Close()

	summary := &models.NutritionSummary{}
	for rows.Next() {
		var log models.FoodLog
		var fi models.FoodItem
		if err := rows.Scan(
			&log.ID, &log.UserID, &log.FoodItemID, &log.MealType, &log.QuantityG, &log.Date, &log.CreatedAt,
			&fi.ID, &fi.Name, &fi.CaloriesPer100g, &fi.ProteinG, &fi.CarbsG, &fi.FatG, &fi.Source,
		); err != nil {
			continue
		}
		ratio := log.QuantityG / 100.0
		log.FoodItem = &fi
		log.Calories = fi.CaloriesPer100g * ratio
		log.ProteinG = fi.ProteinG * ratio
		log.CarbsG = fi.CarbsG * ratio
		log.FatG = fi.FatG * ratio

		summary.Calories += log.Calories
		summary.ProteinG += log.ProteinG
		summary.CarbsG += log.CarbsG
		summary.FatG += log.FatG
		summary.Logs = append(summary.Logs, log)
	}

	return summary, nil
}

// GetWeeklyNutritionTrend returns daily nutrition totals for the last 7 days
func (s *NutritionService) GetWeeklyNutritionTrend(ctx context.Context, userID int64) ([]DailyNutrition, error) {
	rows, err := s.db.Pool.Query(ctx,
		`SELECT fl.date::date as day,
		        SUM(fi.calories_per_100g * fl.quantity_g / 100) as calories,
		        SUM(fi.protein_g * fl.quantity_g / 100) as protein,
		        SUM(fi.carbs_g * fl.quantity_g / 100) as carbs,
		        SUM(fi.fat_g * fl.quantity_g / 100) as fat
		 FROM food_logs fl
		 JOIN food_items fi ON fi.id = fl.food_item_id
		 WHERE fl.user_id = $1 AND fl.date >= CURRENT_DATE - INTERVAL '7 days'
		 GROUP BY day ORDER BY day`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("query weekly nutrition: %w", err)
	}
	defer rows.Close()

	var result []DailyNutrition
	for rows.Next() {
		var d DailyNutrition
		if err := rows.Scan(&d.Date, &d.Calories, &d.ProteinG, &d.CarbsG, &d.FatG); err != nil {
			continue
		}
		result = append(result, d)
	}
	return result, nil
}

// GetActivePlan returns the current active nutrition plan for a user
func (s *NutritionService) GetActivePlan(ctx context.Context, userID int64) (*models.NutritionPlan, error) {
	var plan models.NutritionPlan
	err := s.db.Pool.QueryRow(ctx,
		`SELECT id, user_id, name, calories_target, protein_target, carbs_target, fat_target, active
		 FROM nutrition_plans WHERE user_id = $1 AND active = true LIMIT 1`,
		userID,
	).Scan(&plan.ID, &plan.UserID, &plan.Name, &plan.CaloriesTarget,
		&plan.ProteinTarget, &plan.CarbsTarget, &plan.FatTarget, &plan.Active)
	if err != nil {
		return nil, fmt.Errorf("get active plan: %w", err)
	}
	return &plan, nil
}

// CalculateGoalAdherence returns how closely a user met their nutrition targets (0-100%)
func (s *NutritionService) CalculateGoalAdherence(actual *models.NutritionSummary, plan *models.NutritionPlan) float64 {
	if plan == nil || plan.CaloriesTarget == 0 {
		return 0
	}

	calAdherence := 1.0 - abs(actual.Calories-float64(plan.CaloriesTarget))/float64(plan.CaloriesTarget)
	proteinAdherence := 1.0 - abs(actual.ProteinG-plan.ProteinTarget)/plan.ProteinTarget
	carbsAdherence := 1.0 - abs(actual.CarbsG-plan.CarbsTarget)/plan.CarbsTarget
	fatAdherence := 1.0 - abs(actual.FatG-plan.FatTarget)/plan.FatTarget

	// Clamp to 0-1
	calAdherence = clamp(calAdherence, 0, 1)
	proteinAdherence = clamp(proteinAdherence, 0, 1)
	carbsAdherence = clamp(carbsAdherence, 0, 1)
	fatAdherence = clamp(fatAdherence, 0, 1)

	// Weight calories more heavily
	return (calAdherence*0.4 + proteinAdherence*0.3 + carbsAdherence*0.15 + fatAdherence*0.15) * 100
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func clamp(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
