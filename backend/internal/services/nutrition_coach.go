package services

import (
	"context"
	"fmt"
)

// NutritionCoach answers "what should I eat for the rest of the day". The
// remaining calories/macros are arithmetic the caller already has (today's
// logged totals subtracted from the active plan's targets) — the assistant's
// only job is to turn that remainder into concrete suggestions, so it runs
// synchronously and stays well under the server's WriteTimeout.
type NutritionCoach interface {
	SuggestRestOfDay(ctx context.Context, userContext string, remainingCalories, remainingProteinG, remainingCarbsG, remainingFatG float64) ([]string, error)
}

const nutritionCoachSystemPrompt = `Você sugere o que comer no restante do dia, em português do Brasil, dado quanto de calorias e macronutrientes ainda restam para bater a meta diária da pessoa. Proponha de 2 a 4 sugestões curtas e concretas, com alimentos comuns no dia a dia brasileiro e porções aproximadas em gramas, coerentes com o que resta. Se o restante for pequeno ou negativo, diga isso com naturalidade e sugira algo leve ou nada, sem tom de repreensão. Não prescreva suplemento nem faça diagnóstico. Não use ferramentas.`

var nutritionCoachSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"suggestions": map[string]any{
			"type":  "array",
			"items": map[string]any{"type": "string"},
		},
	},
	"required":             []any{"suggestions"},
	"additionalProperties": false,
}

type nutritionCoach struct {
	generator StructuredGenerator
}

func NewNutritionCoach(generator StructuredGenerator) NutritionCoach {
	return &nutritionCoach{generator: generator}
}

func (a *nutritionCoach) SuggestRestOfDay(ctx context.Context, userContext string, remainingCalories, remainingProteinG, remainingCarbsG, remainingFatG float64) ([]string, error) {
	prompt := fmt.Sprintf("Restam hoje: %.0f kcal, %.0fg proteína, %.0fg carboidrato, %.0fg gordura. Contexto da pessoa: %s",
		remainingCalories, remainingProteinG, remainingCarbsG, remainingFatG, userContext)

	var result struct {
		Suggestions []string `json:"suggestions"`
	}
	if err := a.generator.Generate(ctx, nutritionCoachSystemPrompt, prompt, nutritionCoachSchema, &result); err != nil {
		return nil, err
	}
	if len(result.Suggestions) == 0 {
		return nil, fmt.Errorf("assistant returned no suggestions")
	}
	return result.Suggestions, nil
}
