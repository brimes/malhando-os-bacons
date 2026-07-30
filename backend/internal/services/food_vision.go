package services

import (
	"context"
	"fmt"
	"math"
	"strings"

	"github.com/mob/backend/internal/models"
)

// FoodVisionAssistant reads photos: a plate to estimate what is on it, or a
// nutrition label to transcribe it. The two are deliberately separate prompts
// and schemas — a label is a reading task with one correct answer, a plate is
// an estimate with real uncertainty, and treating them the same makes both
// worse.
type FoodVisionAssistant interface {
	AnalyzePlate(ctx context.Context, images []ImagePart) (*models.PlateAnalysis, error)
	AnalyzeLabel(ctx context.Context, images []ImagePart) (*models.LabelAnalysis, error)
}

const plateSystemPrompt = `Você estima a composição nutricional de um prato de comida a partir de uma ou mais fotos, em português do Brasil. Identifique os alimentos visíveis, estime o peso em gramas de cada um e calcule calorias e macronutrientes correspondentes. Estimar peso por foto é impreciso: informe seu grau de confiança (high, medium ou low) e escreva uma ressalva breve lembrando a pessoa de conferir e ajustar as quantidades antes de registrar. Nunca invente alimentos que não estejam visíveis. Não faça diagnóstico e não use ferramentas.`

var plateSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"items": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"food_name":       map[string]any{"type": "string"},
					"estimated_grams": map[string]any{"type": "number"},
					"calories":        map[string]any{"type": "number"},
					"protein_g":       map[string]any{"type": "number"},
					"carbs_g":         map[string]any{"type": "number"},
					"fat_g":           map[string]any{"type": "number"},
				},
				"required":             []any{"food_name", "estimated_grams", "calories", "protein_g", "carbs_g", "fat_g"},
				"additionalProperties": false,
			},
		},
		"confidence": map[string]any{"type": "string", "enum": []any{"high", "medium", "low"}},
		"caveat":     map[string]any{"type": "string"},
	},
	"required":             []any{"items", "confidence", "caveat"},
	"additionalProperties": false,
}

const labelSystemPrompt = `Você transcreve a tabela de informação nutricional de uma foto de rótulo de alimento, em português do Brasil. Leia nome, marca, porção indicada e os valores nutricionais. Rótulos brasileiros costumam trazer valores "por porção" e/ou "por 100g" — normalize sempre o resultado para calorias e macros por 100g, convertendo a partir da porção quando necessário. Se algum campo não estiver visível ou legível, use zero. Não invente valores. Não use ferramentas.`

var labelSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"name":              map[string]any{"type": "string"},
		"brand":             map[string]any{"type": "string"},
		"serving_label":     map[string]any{"type": "string"},
		"serving_grams":     map[string]any{"type": "number"},
		"calories_per_100g": map[string]any{"type": "number"},
		"protein_g":         map[string]any{"type": "number"},
		"carbs_g":           map[string]any{"type": "number"},
		"fat_g":             map[string]any{"type": "number"},
		"fiber_g":           map[string]any{"type": "number"},
		"sodium_mg":         map[string]any{"type": "number"},
	},
	"required":             []any{"name", "brand", "serving_label", "serving_grams", "calories_per_100g", "protein_g", "carbs_g", "fat_g", "fiber_g", "sodium_mg"},
	"additionalProperties": false,
}

type foodVisionAssistant struct {
	generator VisionGenerator
}

func NewFoodVisionAssistant(generator VisionGenerator) FoodVisionAssistant {
	return &foodVisionAssistant{generator: generator}
}

func (a *foodVisionAssistant) AnalyzePlate(ctx context.Context, images []ImagePart) (*models.PlateAnalysis, error) {
	var result models.PlateAnalysis
	if err := a.generator.GenerateWithImages(ctx, plateSystemPrompt,
		"Analise o prato nesta foto e estime a composição nutricional.", images, plateSchema, &result); err != nil {
		return nil, err
	}
	if len(result.Items) == 0 {
		return nil, fmt.Errorf("assistant could not identify any food in the photo")
	}
	validConfidence := map[string]bool{"high": true, "medium": true, "low": true}
	if !validConfidence[result.Confidence] {
		return nil, fmt.Errorf("assistant returned an invalid confidence: %q", result.Confidence)
	}
	for _, item := range result.Items {
		if strings.TrimSpace(item.FoodName) == "" || item.EstimatedGrams <= 0 {
			return nil, fmt.Errorf("assistant returned an invalid plate item")
		}
	}
	return &result, nil
}

func (a *foodVisionAssistant) AnalyzeLabel(ctx context.Context, images []ImagePart) (*models.LabelAnalysis, error) {
	var result models.LabelAnalysis
	if err := a.generator.GenerateWithImages(ctx, labelSystemPrompt,
		"Leia o rótulo nesta foto e normalize os valores para 100g.", images, labelSchema, &result); err != nil {
		return nil, err
	}
	if strings.TrimSpace(result.Name) == "" {
		return nil, fmt.Errorf("assistant could not read a food name from the label")
	}
	if result.CaloriesPer100g < 0 || result.CaloriesPer100g > 900 {
		return nil, fmt.Errorf("assistant returned an implausible calories_per_100g: %.0f", result.CaloriesPer100g)
	}
	// No macro can exceed 100g per 100g of food, and the declared calories
	// should roughly match what the macros add up to (4/4/9 kcal per gram).
	if result.ProteinG > 100 || result.CarbsG > 100 || result.FatG > 100 {
		return nil, fmt.Errorf("assistant returned a macro above 100g per 100g")
	}
	macroCalories := CaloriesFromMacros(result.ProteinG, result.CarbsG, result.FatG)
	if result.CaloriesPer100g > 0 && !withinTolerance(macroCalories, result.CaloriesPer100g, 0.20) {
		return nil, fmt.Errorf("assistant's macros (%.0f kcal) do not match its declared calories (%.0f kcal)", macroCalories, result.CaloriesPer100g)
	}
	return &result, nil
}

// PlateTotals sums a plate analysis into the macros a food log entry needs,
// so the handler does not repeat this loop.
func PlateTotals(analysis *models.PlateAnalysis) (calories, proteinG, carbsG, fatG float64) {
	for _, item := range analysis.Items {
		calories += item.Calories
		proteinG += item.ProteinG
		carbsG += item.CarbsG
		fatG += item.FatG
	}
	return math.Round(calories*100) / 100, math.Round(proteinG*100) / 100, math.Round(carbsG*100) / 100, math.Round(fatG*100) / 100
}
