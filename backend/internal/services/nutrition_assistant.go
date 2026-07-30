package services

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/mob/backend/internal/models"
)

type NutritionPlanAssistant interface {
	Generate(ctx context.Context, userContext string, energy EnergyProfile, daysPerWeek int, req models.AutomaticNutritionPlanRequest) (*models.NutritionPlanInput, error)
	// Adjust rewrites an existing plan from a free-text instruction, returning
	// the complete plan (not a diff) so the caller can reconcile it in one pass,
	// the same contract training_plan_assistant.go uses for its own Adjust.
	Adjust(ctx context.Context, userContext string, energy EnergyProfile, daysPerWeek int, current models.NutritionPlanInput, instructions string) (*models.NutritionPlanInput, error)
}

const nutritionPlanSystemPrompt = `Você é um planejador de nutrição esportiva cuidadoso. Gere em português do Brasil metas de calorias e macronutrientes e um cardápio prático por refeição, compatível com objetivo, peso, altura, idade, sexo, prazo, volume de treino e histórico alimentar recente fornecidos. Priorize alimentos comuns no dia a dia brasileiro e porções realistas em gramas. Distribua as refeições ao longo do dia (café da manhã, almoço, lanche, jantar) com horários sugeridos plausíveis. Concentre mais carboidratos e proteína ao redor dos dias de treino quando o contexto indicar volume de treino relevante. As calorias e macros de cada item devem ser coerentes com a porção informada. A soma dos itens de cada refeição deve ser compatível com a meta calórica total do dia. Explique o raciocínio de forma breve e objetiva no campo de justificativa. Não prescreva suplemento, restrição clínica ou dieta de exclusão, não faça diagnóstico e não use ferramentas.`

var nutritionPlanSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"name":            map[string]any{"type": "string"},
		"calories_target": map[string]any{"type": "integer"},
		"protein_target":  map[string]any{"type": "number"},
		"carbs_target":    map[string]any{"type": "number"},
		"fat_target":      map[string]any{"type": "number"},
		"rationale":       map[string]any{"type": "string"},
		"meals": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"meal_type":    map[string]any{"type": "string", "enum": []any{"breakfast", "lunch", "dinner", "snack"}},
					"name":         map[string]any{"type": "string"},
					"suggested_at": map[string]any{"type": []any{"string", "null"}},
					"notes":        map[string]any{"type": "string"},
					"items": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"food_name":  map[string]any{"type": "string"},
								"quantity_g": map[string]any{"type": "number"},
								"calories":   map[string]any{"type": "number"},
								"protein_g":  map[string]any{"type": "number"},
								"carbs_g":    map[string]any{"type": "number"},
								"fat_g":      map[string]any{"type": "number"},
							},
							"required":             []any{"food_name", "quantity_g", "calories", "protein_g", "carbs_g", "fat_g"},
							"additionalProperties": false,
						},
					},
				},
				"required":             []any{"meal_type", "name", "suggested_at", "notes", "items"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []any{"name", "calories_target", "protein_target", "carbs_target", "fat_target", "rationale", "meals"},
	"additionalProperties": false,
}

type nutritionPlanAssistant struct {
	generator StructuredGenerator
}

func NewNutritionPlanAssistant(generator StructuredGenerator) NutritionPlanAssistant {
	return &nutritionPlanAssistant{generator: generator}
}

func (a *nutritionPlanAssistant) Generate(ctx context.Context, userContext string, energy EnergyProfile, daysPerWeek int, req models.AutomaticNutritionPlanRequest) (*models.NutritionPlanInput, error) {
	prompt := fmt.Sprintf("Preferências informadas: %q. Contexto completo da pessoa: %s",
		req.Preferences, userContext)

	var plan models.NutritionPlanInput
	if err := a.generator.Generate(ctx, nutritionPlanSystemPrompt, prompt, nutritionPlanSchema, &plan); err != nil {
		return nil, err
	}
	if err := validateNutritionPlanStructure(&plan); err != nil {
		return nil, err
	}
	if err := validateNutritionPlanTargets(&plan, energy, daysPerWeek); err != nil {
		return nil, err
	}
	return &plan, nil
}

const nutritionPlanAdjustPrompt = nutritionPlanSystemPrompt + `

Você está AJUSTANDO um plano nutricional que já existe, a pedido da pessoa. Devolva
o plano COMPLETO, não apenas as partes alteradas. Mantenha intacto tudo que o pedido
não mencionou. Altere somente o que foi pedido e o que for consequência direta disso,
como recalcular a meta calórica quando o cardápio mudar substancialmente.`

func (a *nutritionPlanAssistant) Adjust(ctx context.Context, userContext string, energy EnergyProfile, daysPerWeek int, current models.NutritionPlanInput, instructions string) (*models.NutritionPlanInput, error) {
	currentJSON, err := json.Marshal(current)
	if err != nil {
		return nil, err
	}
	prompt := fmt.Sprintf("Plano atual em JSON: %s\n\nPedido de ajuste da pessoa: %q\n\nContexto da pessoa: %s",
		currentJSON, instructions, userContext)

	var plan models.NutritionPlanInput
	if err := a.generator.Generate(ctx, nutritionPlanAdjustPrompt, prompt, nutritionPlanSchema, &plan); err != nil {
		return nil, err
	}
	if strings.TrimSpace(plan.Name) == "" {
		plan.Name = current.Name
	}
	if err := validateNutritionPlanStructure(&plan); err != nil {
		return nil, err
	}
	if err := validateNutritionPlanTargets(&plan, energy, daysPerWeek); err != nil {
		return nil, err
	}
	return &plan, nil
}

var suggestedAtPattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// validateNutritionPlanStructure checks shape, not safety: at least one meal,
// at least one item per meal, a real meal type, a parseable time.
func validateNutritionPlanStructure(plan *models.NutritionPlanInput) error {
	if strings.TrimSpace(plan.Name) == "" {
		return fmt.Errorf("assistant returned a plan with no name")
	}
	if len(plan.Meals) == 0 {
		return fmt.Errorf("assistant returned a plan with no meals")
	}
	validMealTypes := map[string]bool{"breakfast": true, "lunch": true, "dinner": true, "snack": true}
	for i := range plan.Meals {
		meal := &plan.Meals[i]
		if !validMealTypes[meal.MealType] {
			return fmt.Errorf("assistant returned an invalid meal_type: %q", meal.MealType)
		}
		if meal.SuggestedAt != nil && !suggestedAtPattern.MatchString(*meal.SuggestedAt) {
			return fmt.Errorf("assistant returned an invalid suggested_at: %q", *meal.SuggestedAt)
		}
		if len(meal.Items) == 0 {
			return fmt.Errorf("assistant returned a meal with no items: %q", meal.Name)
		}
		for _, item := range meal.Items {
			if strings.TrimSpace(item.FoodName) == "" || item.QuantityG <= 0 {
				return fmt.Errorf("assistant returned an invalid meal item")
			}
		}
	}
	return nil
}

// validateNutritionPlanTargets is the deterministic safety check the
// assistant's numbers are held against — no prompt reliably holds these
// limits on its own.
func validateNutritionPlanTargets(plan *models.NutritionPlanInput, energy EnergyProfile, daysPerWeek int) error {
	tdee := CalculateTDEE(energy, daysPerWeek)
	if !CaloriesTargetWithinRange(plan.CaloriesTarget, tdee, energy.BiologicalSex) {
		return fmt.Errorf("assistant returned an unsafe or implausible calorie target: %d kcal (TDEE estimado %.0f)", plan.CaloriesTarget, tdee)
	}

	macroCalories := CaloriesFromMacros(plan.ProteinTarget, plan.CarbsTarget, plan.FatTarget)
	if !withinTolerance(macroCalories, float64(plan.CaloriesTarget), 0.10) {
		return fmt.Errorf("assistant's macro targets (%.0f kcal) do not match its calorie target (%d kcal)", macroCalories, plan.CaloriesTarget)
	}

	var itemsCalories float64
	for _, meal := range plan.Meals {
		for _, item := range meal.Items {
			itemsCalories += item.Calories
		}
	}
	if !withinTolerance(itemsCalories, float64(plan.CaloriesTarget), 0.15) {
		return fmt.Errorf("assistant's menu (%.0f kcal) does not match its calorie target (%d kcal)", itemsCalories, plan.CaloriesTarget)
	}
	return nil
}

func withinTolerance(value, target, fraction float64) bool {
	if target <= 0 {
		return false
	}
	return math.Abs(value-target) <= target*fraction
}
