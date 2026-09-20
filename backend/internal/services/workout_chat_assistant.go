package services

import (
	"context"
	"fmt"
	"strings"

	"github.com/mob/backend/internal/models"
)

// WorkoutChatAssistant responde dúvidas durante o treino. É uma chamada
// estruturada por turno, não um chat livre: a mesma resposta carrega o que
// dizer à pessoa E, quando ela pede para trocar um exercício (ou diz que não
// consegue fazê-lo), a proposta de substituição pronta para confirmação —
// nada é alterado no treino sozinho, a pessoa confirma na tela.
type WorkoutChatAssistant interface {
	Reply(ctx context.Context, workoutContext string, messages []ChatMessage) (*models.WorkoutChatDraft, error)
}

const workoutChatAssistantSystemPrompt = `Você é um assistente de treino dentro de um aplicativo de musculação, respondendo em português do Brasil enquanto a pessoa está treinando.

Responda dúvidas sobre execução de exercício, ajuste de carga, substituição de exercício por equipamento ocupado ou indisponível, tempo de descanso e desconforto durante o movimento.

Regras gerais:
- Seja curto e direto. Em geral no máximo 3 frases ou uma lista de até 4 itens. A pessoa está com o celular na mão, no meio da série.
- Use o contexto do treino (exercícios do dia, séries já feitas, cargas) para responder de forma concreta.
- Respeite as lesões e limitações informadas: nunca sugira algo que conflite com elas.
- Você NÃO faz diagnóstico médico e não prescreve tratamento ou medicamento.
- Diante de dor aguda, dor no peito, falta de ar, tontura, formigamento, dor articular que piora ou qualquer sintoma preocupante: oriente parar o exercício e procurar um profissional de saúde. Não tente descobrir a causa.
- Se a dúvida fugir do escopo de treino, diga isso em uma frase e volte ao treino.
- Não invente exercícios que não existem nem números de carga que você não tem como saber.

Proposta de troca (campo substitution):
- Preencha substitution SOMENTE quando a pessoa pedir para trocar o exercício ou disser que não consegue fazê-lo (aparelho ocupado, indisponível, dor, etc). Em qualquer outra dúvida — inclusive perguntas sobre o exercício que não pedem troca — substitution deve ser null.
- training_plan_exercise_id tem de ser exatamente um dos ids listados em "Exercícios previstos para hoje" no contexto, copiado como veio. Nunca invente um id nem escolha o de outro exercício.
- O substituto tem de trabalhar o mesmo grupo muscular do exercício trocado e respeitar as lesões e limitações informadas no contexto.
- new_name, sets, reps, tracking_type, duration_seconds e rest_seconds descrevem o substituto no mesmo formato dos exercícios do plano (duration_seconds só quando tracking_type=time). reason é uma frase curta dizendo por que esse substituto serve.
- answer continua obrigatório mesmo quando substitution é preenchido — é o texto que a pessoa lê no chat. Descreva a troca proposta ali também; o cartão de confirmação na tela é só isso, uma confirmação, não a única explicação.` + gymEquipmentRule

var workoutChatSubstitutionSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"answer": map[string]any{"type": "string"},
		"substitution": map[string]any{
			"type": []any{"object", "null"},
			"properties": map[string]any{
				"training_plan_exercise_id": map[string]any{"type": "integer"},
				"new_name":                  map[string]any{"type": "string"},
				"sets":                      map[string]any{"type": "integer"},
				"reps":                      map[string]any{"type": "integer"},
				"tracking_type":             map[string]any{"type": "string", "enum": []any{"reps", "time"}},
				"duration_seconds":          map[string]any{"type": []any{"integer", "null"}},
				"rest_seconds":              map[string]any{"type": "integer"},
				"notes":                     map[string]any{"type": "string"},
				"reason":                    map[string]any{"type": "string"},
			},
			"required": []any{
				"training_plan_exercise_id", "new_name", "sets", "reps",
				"tracking_type", "duration_seconds", "rest_seconds", "notes", "reason",
			},
			"additionalProperties": false,
		},
	},
	"required":             []any{"answer", "substitution"},
	"additionalProperties": false,
}

type workoutChatAssistant struct {
	generator StructuredGenerator
}

func NewWorkoutChatAssistant(generator StructuredGenerator) WorkoutChatAssistant {
	return &workoutChatAssistant{generator: generator}
}

func (a *workoutChatAssistant) Reply(ctx context.Context, workoutContext string, messages []ChatMessage) (*models.WorkoutChatDraft, error) {
	var conversa strings.Builder
	conversa.WriteString(workoutContext)
	conversa.WriteString("\nConversa até agora:\n")
	for _, m := range messages {
		quem := "Pessoa"
		if m.Role == "assistant" {
			quem = "Você"
		}
		fmt.Fprintf(&conversa, "%s: %s\n", quem, m.Content)
	}
	conversa.WriteString("\nResponda o próximo turno.")

	var draft models.WorkoutChatDraft
	if err := a.generator.Generate(ctx, workoutChatAssistantSystemPrompt, conversa.String(), workoutChatSubstitutionSchema, &draft); err != nil {
		return nil, err
	}
	return &draft, nil
}
