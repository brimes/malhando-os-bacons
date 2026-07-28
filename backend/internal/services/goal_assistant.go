package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mob/backend/internal/models"
)

type GoalAssistantResult struct {
	Message                   string   `json:"message"`
	Action                    *string  `json:"action"`
	Complete                  bool     `json:"complete"`
	GoalType                  *string  `json:"goal_type"`
	TargetWeightKG            *float64 `json:"target_weight_kg"`
	TargetBodyFatPercentage   *float64 `json:"target_body_fat_percentage"`
	TargetMuscleMassKG        *float64 `json:"target_muscle_mass_kg"`
	TargetSixMinuteWalkMeters *int     `json:"target_six_minute_walk_meters"`
	ConditioningFocus         bool     `json:"conditioning_focus"`
	TargetDate                *string  `json:"target_date"`
	Feasibility               *string  `json:"feasibility"`
	FeasibilityWarning        *string  `json:"feasibility_warning"`
	Summary                   *string  `json:"summary"`
}

type GoalAssistant interface {
	Analyze(context.Context, models.UserProfile, *models.FitnessAssessment, []models.OnboardingMessage) (*GoalAssistantResult, error)
}

const goalSystemPrompt = `Você conduz um onboarding de objetivo fitness em português do Brasil. Descubra o objetivo principal, uma ou mais referências mensuráveis e em quanto tempo a pessoa deseja alcançá-lo. As referências possíveis são peso-alvo, percentual de gordura-alvo, massa muscular-alvo ou foco em condicionamento físico. Todas são opcionais individualmente, mas pelo menos uma deve estar definida para concluir. Não force peso se a pessoa não quiser usá-lo. Para condicionamento, marque conditioning_focus=true; a caminhada de 6 minutos será oferecida depois no painel e não bloqueia o onboarding. Você recebe a data atual e deve converter o prazo em target_date YYYY-MM-DD. Avalie a coerência usando referências conservadoras: perda de peso sustentável costuma ficar aproximadamente entre 0,25% e 1% do peso por semana; ganho de peso predominantemente muscular tende a ser mais lento e varia muito; mudanças de gordura, músculo e condicionamento também exigem progressão gradual. Quando uma meta for muito improvável ou potencialmente insegura, não conclua na primeira vez: explique com respeito, proponha uma alternativa factível e faça apenas uma pergunta pedindo confirmação da alternativa. Se o histórico mostrar que a pessoa insiste após ser avisada, aceite, marque feasibility=unrealistic e mantenha um feasibility_warning claro no resumo, sem ensinar práticas perigosas. Use feasibility=challenging para metas difíceis mas plausíveis e realistic para metas coerentes. Não escolha prazo ou meta sem confirmação. Faça perguntas simples e sucintas, sempre uma única pergunta por resposta. Não prescreva dieta, treino, diagnóstico ou tratamento. Use os tipos lose_weight, gain_muscle, recomposition, maintain ou other. Quando completo, o resumo deve incluir referências, prazo e alertas. Não use ferramentas.`

var goalSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"message":                       map[string]any{"type": "string"},
		"action":                        map[string]any{"type": []any{"string", "null"}, "enum": []any{"six_minute_walk", nil}},
		"complete":                      map[string]any{"type": "boolean"},
		"goal_type":                     map[string]any{"type": []any{"string", "null"}, "enum": []any{"lose_weight", "gain_muscle", "recomposition", "maintain", "other", nil}},
		"target_weight_kg":              map[string]any{"type": []any{"number", "null"}},
		"target_body_fat_percentage":    map[string]any{"type": []any{"number", "null"}},
		"target_muscle_mass_kg":         map[string]any{"type": []any{"number", "null"}},
		"target_six_minute_walk_meters": map[string]any{"type": []any{"integer", "null"}},
		"conditioning_focus":            map[string]any{"type": "boolean"},
		"target_date":                   map[string]any{"type": []any{"string", "null"}},
		"feasibility":                   map[string]any{"type": []any{"string", "null"}, "enum": []any{"realistic", "challenging", "unrealistic", nil}},
		"feasibility_warning":           map[string]any{"type": []any{"string", "null"}},
		"summary":                       map[string]any{"type": []any{"string", "null"}},
	},
	"required":             []any{"message", "action", "complete", "goal_type", "target_weight_kg", "target_body_fat_percentage", "target_muscle_mass_kg", "target_six_minute_walk_meters", "conditioning_focus", "target_date", "feasibility", "feasibility_warning", "summary"},
	"additionalProperties": false,
}

type goalAssistant struct {
	generator StructuredGenerator
}

func NewGoalAssistant(generator StructuredGenerator) GoalAssistant {
	return &goalAssistant{generator: generator}
}

func (a *goalAssistant) Analyze(ctx context.Context, profile models.UserProfile, assessment *models.FitnessAssessment, messages []models.OnboardingMessage) (*GoalAssistantResult, error) {
	history, err := json.Marshal(messages)
	if err != nil {
		return nil, err
	}
	sex := "não informado"
	if profile.BiologicalSex != nil {
		sex = *profile.BiologicalSex
	}
	today := time.Now().Format("2006-01-02")
	assessmentContext := "teste de condicionamento ainda não realizado"
	if assessment != nil {
		assessmentContext = fmt.Sprintf("caminhada de 6 minutos: distância=%dm, esforço percebido=%d/10", assessment.DistanceMeters, assessment.PerceivedExertion)
		if assessment.AverageHeartRate != nil {
			assessmentContext += fmt.Sprintf(", FC média=%dbpm", *assessment.AverageHeartRate)
		}
		if assessment.PostHeartRate != nil {
			assessmentContext += fmt.Sprintf(", FC pós-teste=%dbpm", *assessment.PostHeartRate)
		}
	}
	experience := "não informada"
	if profile.TrainingExperience != nil {
		experience = *profile.TrainingExperience
	}
	limitations := "nenhuma informada"
	if profile.InjuriesOrLimitations != nil {
		limitations = *profile.InjuriesOrLimitations
	}
	prompt := fmt.Sprintf("Data atual=%s. Perfil: nascimento=%s, idade=%d, altura=%.1fcm, peso atual=%.1fkg, sexo biológico=%s, experiência=%s, lesões/limitações=%s. Avaliação: %s. Conversa em JSON: %s",
		today, profile.BirthDate.Format("2006-01-02"), profile.Age, profile.HeightCM, profile.CurrentWeightKG, sex, experience, limitations, assessmentContext, history)

	var result GoalAssistantResult
	if err := a.generator.Generate(ctx, goalSystemPrompt, prompt, goalSchema, &result); err != nil {
		return nil, err
	}
	if strings.TrimSpace(result.Message) == "" {
		return nil, fmt.Errorf("assistant returned an empty message")
	}
	if result.Action != nil && *result.Action != "six_minute_walk" && *result.Action != "confirm_unrealistic_goal" {
		return nil, fmt.Errorf("assistant returned an invalid action")
	}
	if result.Complete && (result.GoalType == nil || result.TargetDate == nil || result.Feasibility == nil || result.Summary == nil) {
		return nil, fmt.Errorf("assistant returned an incomplete goal")
	}
	if result.Complete {
		targetDate, err := time.Parse("2006-01-02", *result.TargetDate)
		validType := *result.GoalType == "lose_weight" || *result.GoalType == "gain_muscle" ||
			*result.GoalType == "recomposition" || *result.GoalType == "maintain" || *result.GoalType == "other"
		hasMetric := result.TargetWeightKG != nil || result.TargetBodyFatPercentage != nil || result.TargetMuscleMassKG != nil || result.TargetSixMinuteWalkMeters != nil || result.ConditioningFocus
		// These bounds only reject malformed values. Implausible goals are handled below
		// through a warning and explicit confirmation instead of a hard failure.
		invalidWeight := result.TargetWeightKG != nil && (*result.TargetWeightKG <= 0 || *result.TargetWeightKG > 1000)
		invalidBodyFat := result.TargetBodyFatPercentage != nil && (*result.TargetBodyFatPercentage < 0 || *result.TargetBodyFatPercentage > 100)
		invalidMuscle := result.TargetMuscleMassKG != nil && (*result.TargetMuscleMassKG <= 0 || *result.TargetMuscleMassKG > 500)
		invalidWalk := result.TargetSixMinuteWalkMeters != nil && (*result.TargetSixMinuteWalkMeters <= 0 || *result.TargetSixMinuteWalkMeters > 10000)
		if err != nil || !targetDate.After(time.Now().Truncate(24*time.Hour)) || !validType || !hasMetric ||
			invalidWeight || invalidBodyFat || invalidMuscle || invalidWalk || strings.TrimSpace(*result.Summary) == "" {
			return nil, fmt.Errorf("assistant returned an invalid goal")
		}
		if *result.Feasibility != "realistic" && *result.Feasibility != "challenging" && *result.Feasibility != "unrealistic" {
			return nil, fmt.Errorf("assistant returned invalid feasibility")
		}
		unrealistic, suggestedDate := unrealisticWeightGoal(profile, &result, targetDate)
		previouslyWarned := false
		for _, message := range messages {
			content := strings.ToLower(message.Content)
			if (message.Action != nil && *message.Action == "confirm_unrealistic_goal") ||
				(message.Role == "assistant" && (strings.Contains(content, "improvável") || strings.Contains(content, "insegur") ||
					strings.Contains(content, "irrealista") || (strings.Contains(content, "não") && strings.Contains(content, "realista")))) {
				previouslyWarned = true
				break
			}
		}
		if unrealistic && !previouslyWarned {
			action := "confirm_unrealistic_goal"
			return &GoalAssistantResult{
				Message: fmt.Sprintf("Essa meta em tão pouco tempo é muito improvável e pode não ser segura. Um prazo mais factível seria próximo de %s. Você quer usar esse prazo sugerido?", suggestedDate.Format("02/01/2006")),
				Action:  &action,
			}, nil
		}
		if unrealistic && previouslyWarned {
			feasibility := "unrealistic"
			warning := "A meta foi mantida por sua escolha, mas é muito improvável no prazo informado e pode exigir uma abordagem insegura. Reavalie o prazo com um profissional de saúde."
			result.Feasibility = &feasibility
			result.FeasibilityWarning = &warning
			if !strings.Contains(*result.Summary, warning) {
				updatedSummary := *result.Summary + " " + warning
				result.Summary = &updatedSummary
			}
		}
		if *result.Feasibility == "unrealistic" && result.FeasibilityWarning == nil {
			warning := "A meta foi mantida por sua escolha, mas é muito improvável no prazo informado. Reavalie a meta com um profissional de saúde."
			result.FeasibilityWarning = &warning
		}
	}
	return &result, nil
}

func unrealisticWeightGoal(profile models.UserProfile, result *GoalAssistantResult, targetDate time.Time) (bool, time.Time) {
	if result.TargetWeightKG == nil || profile.CurrentWeightKG <= 0 {
		return false, time.Time{}
	}
	difference := profile.CurrentWeightKG - *result.TargetWeightKG
	weeklyRate := profile.CurrentWeightKG * 0.01
	if result.GoalType != nil && *result.GoalType == "gain_muscle" {
		difference = *result.TargetWeightKG - profile.CurrentWeightKG
		weeklyRate = profile.CurrentWeightKG * 0.005
	}
	if difference <= 0 {
		return false, time.Time{}
	}
	weeksAvailable := targetDate.Sub(time.Now()).Hours() / (24 * 7)
	minimumWeeks := difference / weeklyRate
	if weeksAvailable >= minimumWeeks {
		return false, time.Time{}
	}
	suggestedDate := time.Now().AddDate(0, 0, int(minimumWeeks*7+0.999))
	return true, suggestedDate
}
