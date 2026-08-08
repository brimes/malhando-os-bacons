package handlers

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/mob/backend/internal/db"
)

// maxReviewPeriodDays bounds how far back the review reads. The plan is the
// natural start of the period, but a plan running for a year would push a
// context past what is useful to read — and the recent weeks are what the
// answer actually turns on.
const maxReviewPeriodDays = 180

// reviewPeriod is when the current attempt started: the active training plan's
// creation, since that is what the person has been following. Without one, it
// falls back to the first measurement on record, and finally to four weeks.
func reviewPeriod(ctx context.Context, database *db.DB, userID int64) (time.Time, time.Time) {
	end := time.Now()
	earliest := end.AddDate(0, 0, -maxReviewPeriodDays)

	var start time.Time
	if database.Pool.QueryRow(ctx,
		`SELECT created_at::date FROM training_plans
		 WHERE user_id=$1 AND active=true AND kind='regular' LIMIT 1`, userID,
	).Scan(&start) != nil || start.IsZero() {
		if database.Pool.QueryRow(ctx,
			`SELECT MIN(measured_at) FROM body_measurements WHERE user_id=$1`, userID,
		).Scan(&start) != nil || start.IsZero() {
			start = end.AddDate(0, 0, -28)
		}
	}
	if start.Before(earliest) {
		start = earliest
	}
	return start, end
}

// buildProgressReviewContext is the deepest context the app assembles. It
// starts from buildNutritionContext — profile, goal, recent workouts and
// meals, active plans — and adds what only a review needs: the goal's numeric
// targets and deadline, adherence week by week against the plan's own target,
// the load actually lifted, every measurement in the period, and the food
// averages against the nutrition plan's targets.
//
// It is plain text, not JSON, for the same reason the other context builders
// are: the assistant reads it as prose, and a nested structure would only add
// syntax for it to skip over.
func buildProgressReviewContext(ctx context.Context, database *db.DB, userID int64, start, end time.Time) (string, error) {
	summary, err := buildNutritionContext(ctx, database, userID)
	if err != nil {
		return "", err
	}
	var builder strings.Builder
	builder.WriteString(summary)
	builder.WriteString(fmt.Sprintf("\n\nPeríodo avaliado: de %s até %s (%d dias). Hoje é %s.\n",
		start.Format("2006-01-02"), end.Format("2006-01-02"),
		int(end.Sub(start).Hours()/24)+1, end.Format("2006-01-02")))

	writeGoalTargets(ctx, database, userID, &builder)
	writeTrainingAdherence(ctx, database, userID, start, &builder)
	writeLoadProgression(ctx, database, userID, &builder)
	writeMeasurements(ctx, database, userID, start, &builder)
	writeNutritionAdherence(ctx, database, userID, start, &builder)
	return builder.String(), nil
}

func writeGoalTargets(ctx context.Context, database *db.DB, userID int64, builder *strings.Builder) {
	var goalType, feasibility, goalSummary string
	var targetWeight, targetFat, targetMuscle *float64
	var targetWalk *int
	var targetDate *time.Time
	if database.Pool.QueryRow(ctx,
		`SELECT goal_type, summary, feasibility, target_weight_kg, target_body_fat_percentage,
		        target_muscle_mass_kg, target_six_minute_walk_meters, target_date
		 FROM user_goals WHERE user_id=$1`, userID,
	).Scan(&goalType, &goalSummary, &feasibility, &targetWeight, &targetFat,
		&targetMuscle, &targetWalk, &targetDate) != nil {
		builder.WriteString("Metas numéricas: nenhuma registrada.\n")
		return
	}
	builder.WriteString(fmt.Sprintf("Objetivo declarado (%s, viabilidade avaliada como %s): %s\n",
		goalType, feasibility, goalSummary))
	builder.WriteString("Metas numéricas: ")
	builder.WriteString(optionalFloat("peso-alvo", targetWeight, "kg"))
	builder.WriteString(optionalFloat("gordura-alvo", targetFat, "%"))
	builder.WriteString(optionalFloat("massa magra-alvo", targetMuscle, "kg"))
	if targetWalk != nil {
		builder.WriteString(fmt.Sprintf("caminhada de 6 minutos-alvo=%dm; ", *targetWalk))
	}
	if targetDate != nil {
		days := int(time.Until(*targetDate).Hours() / 24)
		builder.WriteString(fmt.Sprintf("prazo=%s (faltam %d dias)", targetDate.Format("2006-01-02"), days))
	} else {
		builder.WriteString("sem prazo definido")
	}
	builder.WriteString(".\n")
}

func optionalFloat(label string, value *float64, unit string) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%s=%.1f%s; ", label, *value, unit)
}

// writeTrainingAdherence answers the question the person actually asks: did I
// train what I said I would. Weeks come from date_trunc, not from counting
// rows, so a week with zero workouts still shows up as zero instead of
// vanishing from the list.
func writeTrainingAdherence(ctx context.Context, database *db.DB, userID int64, start time.Time, builder *strings.Builder) {
	var target int
	_ = database.Pool.QueryRow(ctx,
		`SELECT days_per_week FROM training_plans
		 WHERE user_id=$1 AND active=true AND kind='regular' LIMIT 1`, userID).Scan(&target)

	rows, err := database.Pool.Query(ctx,
		`SELECT weeks.week::date, COUNT(w.id)
		 FROM generate_series(date_trunc('week', $2::date), date_trunc('week', CURRENT_DATE), INTERVAL '1 week') AS weeks(week)
		 LEFT JOIN workouts w
		   ON w.user_id = $1 AND w.status = 'completed'
		  AND date_trunc('week', w.date::date) = weeks.week
		 GROUP BY weeks.week ORDER BY weeks.week`, userID, start.Format("2006-01-02"))
	if err != nil {
		return
	}
	defer rows.Close()
	builder.WriteString(fmt.Sprintf("Aderência ao treino (meta de %d treinos por semana), semana a semana: ", target))
	total := 0
	weeks := 0
	for rows.Next() {
		var week time.Time
		var done int
		if rows.Scan(&week, &done) != nil {
			continue
		}
		builder.WriteString(fmt.Sprintf("[semana de %s: %d treinos] ", week.Format("2006-01-02"), done))
		total += done
		weeks++
	}
	if weeks > 0 {
		builder.WriteString(fmt.Sprintf("— %d treinos em %d semanas, média de %.1f por semana.",
			total, weeks, float64(total)/float64(weeks)))
	}
	builder.WriteString("\n")
}

// writeLoadProgression is the part buildUserContext does not carry: the weight
// actually lifted. Comparing the first and last load of each exercise is what
// separates "treinou" from "evoluiu".
func writeLoadProgression(ctx context.Context, database *db.DB, userID int64, builder *strings.Builder) {
	rows, err := database.Pool.Query(ctx,
		`SELECT ws.exercise_name,
		        COUNT(*),
		        MAX(ws.weight_kg) FILTER (WHERE w.date::date = first.first_date),
		        MAX(ws.weight_kg) FILTER (WHERE w.date::date = first.last_date)
		 FROM workout_sets ws
		 JOIN workouts w ON w.id = ws.workout_id
		 JOIN (
		   SELECT ws2.exercise_name, MIN(w2.date::date) AS first_date, MAX(w2.date::date) AS last_date
		   FROM workout_sets ws2 JOIN workouts w2 ON w2.id = ws2.workout_id
		   WHERE w2.user_id = $1 AND w2.status = 'completed' AND w2.date >= CURRENT_DATE - INTERVAL '60 days'
		   GROUP BY ws2.exercise_name
		 ) first ON first.exercise_name = ws.exercise_name
		 WHERE w.user_id = $1 AND w.status = 'completed' AND w.date >= CURRENT_DATE - INTERVAL '60 days'
		 GROUP BY ws.exercise_name ORDER BY COUNT(*) DESC LIMIT 25`, userID)
	if err != nil {
		return
	}
	defer rows.Close()
	builder.WriteString("Carga por exercício nos últimos 60 dias (primeira sessão → última): ")
	any := false
	for rows.Next() {
		var name string
		var sets int
		var firstWeight, lastWeight *float64
		if rows.Scan(&name, &sets, &firstWeight, &lastWeight) != nil {
			continue
		}
		any = true
		builder.WriteString(fmt.Sprintf("[%s: %d séries, %s → %s] ",
			name, sets, weightText(firstWeight), weightText(lastWeight)))
	}
	if !any {
		builder.WriteString("nenhuma série registrada no período")
	}
	builder.WriteString("\n")
}

func weightText(value *float64) string {
	if value == nil || *value <= 0 {
		return "sem carga"
	}
	return fmt.Sprintf("%.1fkg", *value)
}

func writeMeasurements(ctx context.Context, database *db.DB, userID int64, start time.Time, builder *strings.Builder) {
	rows, err := database.Pool.Query(ctx,
		`SELECT measured_at, weight_kg, body_fat_percentage, muscle_mass_kg, waist_cm, hip_cm, arm_cm, thigh_cm, chest_cm
		 FROM body_measurements WHERE user_id=$1 AND measured_at >= $2 ORDER BY measured_at`, userID, start)
	if err != nil {
		return
	}
	defer rows.Close()
	builder.WriteString("Medições no período (da mais antiga para a mais recente): ")
	any := false
	for rows.Next() {
		var date time.Time
		var weight, fat, muscle, waist, hip, arm, thigh, chest *float64
		if rows.Scan(&date, &weight, &fat, &muscle, &waist, &hip, &arm, &thigh, &chest) != nil {
			continue
		}
		any = true
		builder.WriteString("[" + date.Format("2006-01-02") + " ")
		builder.WriteString(optionalFloat("peso", weight, "kg"))
		builder.WriteString(optionalFloat("gordura", fat, "%"))
		builder.WriteString(optionalFloat("massa magra", muscle, "kg"))
		builder.WriteString(optionalFloat("cintura", waist, "cm"))
		builder.WriteString(optionalFloat("quadril", hip, "cm"))
		builder.WriteString(optionalFloat("braço", arm, "cm"))
		builder.WriteString(optionalFloat("coxa", thigh, "cm"))
		builder.WriteString(optionalFloat("peito", chest, "cm"))
		builder.WriteString("] ")
	}
	if !any {
		builder.WriteString("nenhuma medição registrada no período — não é possível medir evolução corporal, diga isso")
	}
	builder.WriteString("\n")
}

// writeNutritionAdherence gives averages and the count of days with any record
// at all. The second number matters as much as the first: an average over four
// logged days out of thirty says nothing about how the person ate.
func writeNutritionAdherence(ctx context.Context, database *db.DB, userID int64, start time.Time, builder *strings.Builder) {
	var caloriesTarget int
	var proteinTarget, carbsTarget, fatTarget float64
	hasPlan := database.Pool.QueryRow(ctx,
		`SELECT calories_target, protein_target, carbs_target, fat_target
		 FROM nutrition_plans WHERE user_id=$1 AND active=true LIMIT 1`, userID,
	).Scan(&caloriesTarget, &proteinTarget, &carbsTarget, &fatTarget) == nil

	var loggedDays int
	var avgCalories, avgProtein, avgCarbs, avgFat *float64
	_ = database.Pool.QueryRow(ctx,
		`SELECT COUNT(*), AVG(calories), AVG(protein), AVG(carbs), AVG(fat) FROM (
		   SELECT date::date, SUM(calories) AS calories, SUM(protein_g) AS protein,
		          SUM(carbs_g) AS carbs, SUM(fat_g) AS fat
		   FROM food_logs WHERE user_id=$1 AND date >= $2 GROUP BY date::date
		 ) daily`, userID, start,
	).Scan(&loggedDays, &avgCalories, &avgProtein, &avgCarbs, &avgFat)

	totalDays := int(time.Since(start).Hours()/24) + 1
	builder.WriteString(fmt.Sprintf("Alimentação no período: %d dias com registro de %d dias possíveis. ", loggedDays, totalDays))
	if loggedDays > 0 && avgCalories != nil {
		builder.WriteString(fmt.Sprintf("Média por dia registrado: %.0fkcal, P%.0fg, C%.0fg, G%.0fg. ",
			*avgCalories, *avgProtein, *avgCarbs, *avgFat))
	}
	if hasPlan {
		builder.WriteString(fmt.Sprintf("Metas do plano: %dkcal, P%.0fg, C%.0fg, G%.0fg. ",
			caloriesTarget, proteinTarget, carbsTarget, fatTarget))
	}
	builder.WriteString("\n")

	rows, err := database.Pool.Query(ctx,
		`SELECT date::date, SUM(calories), SUM(protein_g), SUM(carbs_g), SUM(fat_g)
		 FROM food_logs WHERE user_id=$1 AND date >= CURRENT_DATE - INTERVAL '28 days'
		 GROUP BY date::date ORDER BY date::date`, userID)
	if err != nil {
		return
	}
	defer rows.Close()
	builder.WriteString("Detalhe diário dos últimos 28 dias: ")
	for rows.Next() {
		var date time.Time
		var calories, protein, carbs, fat float64
		if rows.Scan(&date, &calories, &protein, &carbs, &fat) == nil {
			builder.WriteString(fmt.Sprintf("[%s: %.0fkcal P%.0fg C%.0fg G%.0fg] ",
				date.Format("2006-01-02"), calories, protein, carbs, fat))
		}
	}
	builder.WriteString("\n")

	var cheatDays int
	_ = database.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM cheat_day_sessions WHERE user_id=$1 AND status='accepted' AND created_at >= $2`,
		userID, start).Scan(&cheatDays)
	builder.WriteString(fmt.Sprintf("Dias do lixo compensados no período: %d.\n", cheatDays))
}
