package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mob/backend/internal/models"
)

type TrainingPlanAssistant interface {
	Generate(context.Context, string, models.AutomaticTrainingPlanRequest) (*models.TrainingPlanInput, error)
	// Adjust rewrites an existing plan from a free-text instruction, returning
	// the complete plan (not a diff) so the caller can reconcile it in one pass.
	Adjust(context.Context, string, models.TrainingPlanInput, string) (*models.TrainingPlanInput, error)
}

const trainingPlanSystemPrompt = `Você é um planejador de treinos de musculação cuidadoso. Gere em português do Brasil um plano prático, progressivo e compatível com objetivo, experiência, histórico, preferências, duração disponível, lesões e limitações fornecidas. Se for iniciante em adaptação, use exercícios simples, volume moderado, técnica como prioridade e evite falha muscular. Nunca inclua exercício que conflite com uma limitação informada; ofereça variações seguras nas notas. Todo dia deve começar com pelo menos um exercício de aquecimento explícito. Aquecimento em esteira, bicicleta, mobilidade ou isometria deve usar tracking_type=time e duration_seconds; exercícios de força normalmente usam tracking_type=reps. Para exercícios por tempo, use reps=1. Cada dia deve caber no tempo disponível e ter entre 4 e 9 exercícios contando o aquecimento. Retorne exatamente a quantidade de dias solicitada. Não faça diagnóstico, não use ferramentas e não inclua recomendações médicas.`

var trainingPlanSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"name":        map[string]any{"type": "string"},
		"description": map[string]any{"type": "string"},
		"days": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name":         map[string]any{"type": "string"},
					"focus":        map[string]any{"type": "string"},
					"instructions": map[string]any{"type": "string"},
					"exercises": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"exercise_name":    map[string]any{"type": "string"},
								"sets":             map[string]any{"type": "integer"},
								"reps":             map[string]any{"type": "integer"},
								"tracking_type":    map[string]any{"type": "string", "enum": []any{"reps", "time"}},
								"duration_seconds": map[string]any{"type": []any{"integer", "null"}},
								"rest_seconds":     map[string]any{"type": "integer"},
								"notes":            map[string]any{"type": "string"},
							},
							"required":             []any{"exercise_name", "sets", "reps", "tracking_type", "duration_seconds", "rest_seconds", "notes"},
							"additionalProperties": false,
						},
					},
				},
				"required":             []any{"name", "focus", "instructions", "exercises"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []any{"name", "description", "days"},
	"additionalProperties": false,
}

type trainingPlanAssistant struct {
	generator StructuredGenerator
}

func NewTrainingPlanAssistant(generator StructuredGenerator) TrainingPlanAssistant {
	return &trainingPlanAssistant{generator: generator}
}

func (a *trainingPlanAssistant) Generate(ctx context.Context, userContext string, req models.AutomaticTrainingPlanRequest) (*models.TrainingPlanInput, error) {
	prompt := fmt.Sprintf("Crie um plano com %d dias por semana, sessões de %d minutos e data-alvo %s. Nome sugerido pelo usuário: %q. Preferências informadas: %q. Contexto completo: %s",
		req.DaysPerWeek, req.SessionDurationMinutes, req.TargetDate, req.Name, req.Preferences, userContext)

	var plan models.TrainingPlanInput
	if err := a.generator.Generate(ctx, trainingPlanSystemPrompt, prompt, trainingPlanSchema, &plan); err != nil {
		return nil, err
	}

	plan.TargetDate = req.TargetDate
	plan.DaysPerWeek = req.DaysPerWeek
	plan.SessionDurationMinutes = req.SessionDurationMinutes
	if strings.TrimSpace(req.Name) != "" {
		plan.Name = strings.TrimSpace(req.Name)
	}
	if len(plan.Days) != req.DaysPerWeek {
		return nil, fmt.Errorf("assistant returned %d days, expected %d", len(plan.Days), req.DaysPerWeek)
	}
	return &plan, nil
}

const trainingPlanAdjustPrompt = trainingPlanSystemPrompt + `

Você está AJUSTANDO um plano que já existe, a pedido da pessoa. Regras do ajuste:
Devolva o plano COMPLETO, não apenas as partes alteradas. Mantenha intacto tudo
que o pedido não mencionou: nomes de dias, exercícios, séries, repetições e
descansos que não foram citados devem voltar exatamente como estavam. Altere
somente o que foi pedido e o que for consequência direta disso. O pedido pode
mudar o nome do plano, sua descrição, o nome ou o foco de um dia, ou trocar,
remover e acrescentar exercícios. Preserve a ordem dos dias sempre que possível.
Se o pedido conflitar com uma limitação ou lesão informada no contexto, escolha
a alternativa segura mais próxima e explique na nota do exercício.`

func (a *trainingPlanAssistant) Adjust(ctx context.Context, userContext string, current models.TrainingPlanInput, instructions string) (*models.TrainingPlanInput, error) {
	currentJSON, err := json.Marshal(current)
	if err != nil {
		return nil, err
	}
	prompt := fmt.Sprintf("Plano atual em JSON: %s\n\nPedido de ajuste da pessoa: %q\n\nContexto da pessoa: %s",
		currentJSON, instructions, userContext)

	var plan models.TrainingPlanInput
	if err := a.generator.Generate(ctx, trainingPlanAdjustPrompt, prompt, trainingPlanSchema, &plan); err != nil {
		return nil, err
	}
	if len(plan.Days) == 0 {
		return nil, fmt.Errorf("assistant returned a plan with no days")
	}
	if strings.TrimSpace(plan.Name) == "" {
		plan.Name = current.Name
	}
	// The schedule fields are not part of the schema, so they survive the round
	// trip only if carried over. Days per week follows whatever came back.
	plan.TargetDate = current.TargetDate
	plan.SessionDurationMinutes = current.SessionDurationMinutes
	plan.DaysPerWeek = len(plan.Days)
	return &plan, nil
}
