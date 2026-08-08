package services

import (
	"context"
	"fmt"
	"strings"

	"github.com/mob/backend/internal/models"
)

// ProgressReviewAssistant reads the period's history against the goal and says
// how it went, whether the goal is still reachable, and — only when it is not —
// what to change in the training and nutrition plans.
//
// It deliberately does NOT produce the plans themselves. Turning the change
// into a plan is TrainingPlanAssistant.Adjust / NutritionPlanAssistant.Adjust,
// the same call the manual "ajustar plano" button makes, so the safety
// validations that live there (calorie range, macro coherence, exercise
// limits) apply to a plan proposed by the review exactly as they do to one
// asked for by hand.
type ProgressReviewAssistant interface {
	Review(ctx context.Context, reviewContext string) (*models.ProgressReviewAnalysis, error)
}

const progressReviewSystemPrompt = `Você avalia o progresso de uma pessoa em um programa de treino e alimentação, em português do Brasil, com base no histórico real que recebe: treinos executados (com séries, repetições e cargas), alimentação registrada dia a dia, medições corporais ao longo do tempo, testes de condicionamento e o objetivo declarado com suas metas numéricas e prazo.

Escreva para a pessoa, em segunda pessoa, direto e sem jargão. Cite números do histórico — quantos treinos fez contra quantos estavam previstos, média de calorias e proteína contra a meta, quanto o peso ou a medida mudou e em quanto tempo. Nunca invente número que não esteja no contexto; quando faltar dado, diga que faltou registro em vez de estimar.

Preencha:

1. performance: como foi o desempenho no período, com ênfase na última semana. Aderência ao treino, o que evoluiu em carga ou volume, o que ficou para trás, e como foi a alimentação (constância dos registros, calorias e macros contra a meta). 3 a 6 frases. Reconheça o que foi bem antes de apontar o que faltou.

2. goal_assessment: se a pessoa está no caminho do objetivo. Compare o ritmo observado com o que o prazo exige. Se estiver no ritmo, diga isso com clareza. Se precisar corrigir a rota, diga o que precisa mudar. Se o objetivo ficou mais difícil ou improvável no prazo, avise sem rodeio e explique o porquê — a pessoa precisa saber para decidir, e adiar esse aviso só encurta o tempo que ela tem para reagir. 3 a 6 frases.

3. goal_status: on_track quando o ritmo atual chega lá; needs_change quando chega, mas só com ajuste; at_risk quando o prazo ficou improvável mesmo com ajuste.

4. training_change e nutrition_change: proponha mudança APENAS quando o histórico justificar. Plano que está funcionando não se mexe, e mudar por mudar apaga a referência que a pessoa levou semanas construindo. Se não houver o que mudar, needed=false com summary e instructions vazios.
   - Quando houver: summary é para a pessoa ler antes de confirmar — o que muda, em quanto, e por quê, em 1 a 3 frases concretas ("subir a meta de proteína de 140g para 165g porque a média das últimas semanas ficou em 110g e a massa magra caiu 0,8kg").
   - instructions é para o assistente que reescreve o plano: um pedido específico e autocontido, no imperativo, dizendo exatamente o que alterar e o que preservar. Ele não vê esta análise, só o plano atual e este pedido.
   - Respeite lesões e limitações informadas. Nunca proponha meta calórica agressiva nem restrição alimentar clínica.

Não faça diagnóstico, não prescreva suplemento ou medicamento e não use ferramentas.`

var progressReviewChangeSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"needed":       map[string]any{"type": "boolean"},
		"summary":      map[string]any{"type": "string"},
		"instructions": map[string]any{"type": "string"},
	},
	"required":             []any{"needed", "summary", "instructions"},
	"additionalProperties": false,
}

var progressReviewSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"performance":     map[string]any{"type": "string"},
		"goal_assessment": map[string]any{"type": "string"},
		"goal_status": map[string]any{
			"type": "string",
			"enum": []any{"on_track", "needs_change", "at_risk"},
		},
		"training_change":  progressReviewChangeSchema,
		"nutrition_change": progressReviewChangeSchema,
	},
	"required":             []any{"performance", "goal_assessment", "goal_status", "training_change", "nutrition_change"},
	"additionalProperties": false,
}

type progressReviewAssistant struct {
	generator StructuredGenerator
}

func NewProgressReviewAssistant(generator StructuredGenerator) ProgressReviewAssistant {
	return &progressReviewAssistant{generator: generator}
}

func (a *progressReviewAssistant) Review(ctx context.Context, reviewContext string) (*models.ProgressReviewAnalysis, error) {
	prompt := "Histórico completo da pessoa no período avaliado:\n\n" + reviewContext

	var analysis models.ProgressReviewAnalysis
	if err := a.generator.Generate(ctx, progressReviewSystemPrompt, prompt, progressReviewSchema, &analysis); err != nil {
		return nil, err
	}
	if strings.TrimSpace(analysis.Performance) == "" || strings.TrimSpace(analysis.GoalAssessment) == "" {
		return nil, fmt.Errorf("assistant returned an empty review")
	}
	switch analysis.GoalStatus {
	case "on_track", "needs_change", "at_risk":
	default:
		analysis.GoalStatus = "needs_change"
	}
	// A change with nothing to hand the plan assistant is not a change. Letting
	// it through would enqueue an Adjust with an empty instruction, and the
	// assistant would rewrite the plan on its own judgment — exactly the
	// unprompted rewrite this feature must not do.
	if strings.TrimSpace(analysis.TrainingChange.Instructions) == "" {
		analysis.TrainingChange = models.ProgressReviewProposal{}
	}
	if strings.TrimSpace(analysis.NutritionChange.Instructions) == "" {
		analysis.NutritionChange = models.ProgressReviewProposal{}
	}
	return &analysis, nil
}
