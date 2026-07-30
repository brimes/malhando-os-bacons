package services

import (
	"context"
	"fmt"
	"strings"

	"github.com/mob/backend/internal/models"
)

// CheatDayAssistant builds the compensation for a cheat day once the person
// accepts. The conversation itself (the back-and-forth about what they are
// about to eat) runs through ChatGenerator directly in the handler, the same
// way workout_chat.go does — no separate wrapper needed for free text.
//
// The safety limits below are product requirements, not decoration: framing
// food as debt and exercise as punishment is the exact script of disordered
// eating, and no amount of polite prompt language holds that line reliably on
// its own — the caps are enforced in validateCompensation, in code.
type CheatDayAssistant interface {
	BuildCompensation(ctx context.Context, userContext string, conversationSummary string) (*models.CheatDayCompensation, error)
}

// cheatDaySystemPrompt builds on trainingPlanSystemPrompt so the compensation
// plan's exercises follow the exact same technical shape a regular plan does
// (warmup required, tracking_type=time paired with duration_seconds and
// reps=1, 4-9 exercises per day) — without this, the model has no reason to
// know those rules apply here too, and returns something the DB rejects.
const cheatDaySystemPrompt = trainingPlanSystemPrompt + `

Além disso, você ajuda a pessoa a lidar com um exagero alimentar planejado (um "dia do lixo"), em português do Brasil. Seu tom é de ajuste de rota, nunca de punição ou culpa: nunca diga que o treino vai "queimar" ou "pagar" o que foi comido. Quando a pessoa aceitar uma compensação, proponha uma estimativa realista de calorias excedentes e um plano de treino de compensação com no máximo 3 dias, que substitui temporariamente os próximos treinos e depois o plano normal volta sozinho. Nunca combine a compensação com um corte adicional de calorias na alimentação — é uma coisa ou outra, nunca as duas. Se o excedente estimado for muito grande, não proponha um treino desproporcional: sugira retomar o plano normal e seguir em frente.`

var cheatDayCompensationSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"estimated_calories": map[string]any{"type": "integer"},
		"summary":            map[string]any{"type": "string"},
		"expires_in_days":    map[string]any{"type": "integer"},
		"compensation_plan":  trainingPlanSchema,
	},
	"required":             []any{"estimated_calories", "summary", "expires_in_days", "compensation_plan"},
	"additionalProperties": false,
}

type cheatDayAssistant struct {
	generator StructuredGenerator
}

func NewCheatDayAssistant(generator StructuredGenerator) CheatDayAssistant {
	return &cheatDayAssistant{generator: generator}
}

func (a *cheatDayAssistant) BuildCompensation(ctx context.Context, userContext string, conversationSummary string) (*models.CheatDayCompensation, error) {
	prompt := fmt.Sprintf("Resumo do que a pessoa vai comer: %q. Contexto da pessoa: %s", conversationSummary, userContext)

	var result models.CheatDayCompensation
	if err := a.generator.Generate(ctx, cheatDaySystemPrompt, prompt, cheatDayCompensationSchema, &result); err != nil {
		return nil, err
	}
	if err := validateCompensation(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

const (
	maxCompensationDays      = 3
	maxCompensationDaysAhead = 7
	// Above this, more training is not a sane answer — the plan tells the
	// assistant to fall back to "just resume the normal plan" instead.
	maxSensibleSurplusCalories = 4000
)

func validateCompensation(result *models.CheatDayCompensation) error {
	if result.EstimatedCalories < 0 || result.EstimatedCalories > maxSensibleSurplusCalories {
		return fmt.Errorf("assistant returned an implausible surplus: %d kcal", result.EstimatedCalories)
	}
	if result.ExpiresInDays < 1 || result.ExpiresInDays > maxCompensationDaysAhead {
		return fmt.Errorf("assistant returned an invalid expiry: %d days", result.ExpiresInDays)
	}
	days := result.CompensationPlan.Days
	if len(days) == 0 || len(days) > maxCompensationDays {
		return fmt.Errorf("assistant returned %d compensation days, expected 1-%d", len(days), maxCompensationDays)
	}
	// Same bounds training_plans' CHECK constraints enforce, checked here first
	// so a violation comes back as a clear rejection instead of a raw DB error.
	for dayIndex, day := range days {
		if strings.TrimSpace(day.Name) == "" || len(day.Exercises) == 0 || len(day.Exercises) > 9 {
			return fmt.Errorf("assistant returned an invalid compensation day %d", dayIndex+1)
		}
		for _, exercise := range day.Exercises {
			trackingType := exercise.TrackingType
			if trackingType == "" {
				trackingType = "reps"
			}
			if strings.TrimSpace(exercise.ExerciseName) == "" || exercise.Sets < 1 || exercise.Sets > 20 ||
				exercise.Reps < 1 || exercise.Reps > 100 || exercise.RestSeconds < 0 || exercise.RestSeconds > 600 ||
				(trackingType != "reps" && trackingType != "time") ||
				(trackingType == "time" && (exercise.DurationSeconds == nil || *exercise.DurationSeconds < 1 || *exercise.DurationSeconds > 7200)) {
				return fmt.Errorf("assistant returned an invalid compensation exercise in day %d", dayIndex+1)
			}
		}
	}
	return nil
}
