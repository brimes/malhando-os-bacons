package handlers

import (
	"context"
	"fmt"
	"time"

	"github.com/mob/backend/internal/db"
)

// buildNutritionContext extends buildUserContext (training_plans.go) with the
// data a nutrition assistant needs that a training assistant does not: the
// active training plan's schedule (so meal timing and calorie targets can
// match training days), the nutrition plan already in place, what was
// actually eaten in the last week, and the recent weight trend. Package-level
// for the same reason buildUserContext is: more than one handler calls it.
func buildNutritionContext(ctx context.Context, database *db.DB, userID int64) (string, error) {
	summary, err := buildUserContext(ctx, database, userID)
	if err != nil {
		return "", err
	}

	var planName string
	var daysPerWeek, sessionMinutes int
	if database.Pool.QueryRow(ctx,
		`SELECT name, days_per_week, session_duration_minutes FROM training_plans
		 WHERE user_id=$1 AND active=true AND kind='regular' LIMIT 1`, userID,
	).Scan(&planName, &daysPerWeek, &sessionMinutes) == nil {
		summary += fmt.Sprintf("Plano de treino ativo: %q, %d dias por semana, sessões de %d minutos. ",
			planName, daysPerWeek, sessionMinutes)
	} else {
		summary += "Sem plano de treino ativo no momento. "
	}

	var nutritionPlanName string
	var caloriesTarget int
	if database.Pool.QueryRow(ctx,
		`SELECT name, calories_target FROM nutrition_plans WHERE user_id=$1 AND active=true LIMIT 1`, userID,
	).Scan(&nutritionPlanName, &caloriesTarget) == nil {
		summary += fmt.Sprintf("Plano nutricional ativo: %q, meta de %d kcal/dia. ", nutritionPlanName, caloriesTarget)
	} else {
		summary += "Sem plano nutricional ativo no momento. "
	}

	rows, err := database.Pool.Query(ctx,
		`SELECT date::date, SUM(calories), SUM(protein_g), SUM(carbs_g), SUM(fat_g)
		 FROM food_logs WHERE user_id=$1 AND date >= CURRENT_DATE - INTERVAL '7 days'
		 GROUP BY date::date ORDER BY date::date DESC`, userID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	summary += "Alimentação dos últimos dias: "
	for rows.Next() {
		var date time.Time
		var calories, protein, carbs, fat float64
		if rows.Scan(&date, &calories, &protein, &carbs, &fat) == nil {
			summary += fmt.Sprintf("[%s: %.0fkcal P%.0fg C%.0fg G%.0fg] ",
				date.Format("2006-01-02"), calories, protein, carbs, fat)
		}
	}

	var latestWeight float64
	var latestDate time.Time
	if database.Pool.QueryRow(ctx,
		`SELECT weight_kg, measured_at FROM body_measurements
		 WHERE user_id=$1 AND weight_kg IS NOT NULL ORDER BY measured_at DESC LIMIT 1`, userID,
	).Scan(&latestWeight, &latestDate) == nil {
		summary += fmt.Sprintf("Peso mais recente registrado: %.1fkg em %s. ", latestWeight, latestDate.Format("2006-01-02"))
	}

	return summary, nil
}
