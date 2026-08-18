package services

import (
	"context"
	"fmt"
	"strings"

	"github.com/mob/backend/internal/models"
)

// NutritionLogAssistant conduz a conversa do "modo IA" da tela de registrar:
// a pessoa conta o que comeu em texto livre, o assistente pergunta o que falta
// e, quando tem tudo, devolve os registros prontos para revisão.
//
// É uma chamada estruturada por turno, não um chat livre: a mesma resposta
// carrega o que dizer à pessoa E, quando já dá, a lista de alimentos. Um chat
// livre com uma segunda chamada de extração no fim deixaria a lista livre para
// discordar do que foi conversado — e é a lista que vira registro.
type NutritionLogAssistant interface {
	Next(ctx context.Context, userContext, hoje string, messages []ChatMessage) (*models.NutritionLogDraft, error)
}

const nutritionLogSystemPrompt = `Você ajuda a pessoa a registrar o que ela comeu, conversando em português do Brasil. Ela descreve a refeição em linguagem natural e você transforma isso em registros com calorias e macronutrientes.

Como conduzir:
- Faça UMA pergunta por vez, curta. Pergunte só o que muda o resultado: quantidade aproximada (pedaços, colheres, unidades, tamanho da porção), o que era exatamente quando o nome for ambíguo, se havia bebida, e em que refeição e dia foi.
- Nunca peça o peso em gramas. A pessoa não sabe. Traduza a medida caseira que ela der ("3 pedaços de pizza", "um prato cheio", "uma lata") para gramas você mesmo.
- Aceite estimativas. "Uns 3 pedaços" é resposta suficiente; não insista em precisão que ninguém tem.
- Duas ou três perguntas costumam bastar. Se a pessoa já disse tudo na primeira frase, não pergunte nada: complete.
- Se ela não disser quando foi, pergunte — mas se disser algo como "ontem à noite", resolva a data você mesmo a partir da data de hoje informada no contexto, sem perguntar de novo.

Quando tiver o suficiente, devolva complete=true e preencha entries com um item por alimento ou bebida:
- food_name: como a pessoa reconheceria ("Pizza de 4 queijos", "Coca-Cola Zero"), não um nome de tabela nutricional.
- quantity_g: o peso total em gramas daquele item, já multiplicado pela quantidade consumida. Bebida em mililitros conta como gramas.
- calories, protein_g, carbs_g, fat_g: totais daquele item para a quantidade informada, NÃO por 100g. Devem ser coerentes entre si (cerca de 4 kcal por grama de proteína e de carboidrato, 9 por grama de gordura).
- meal_type: breakfast, lunch, dinner ou snack.
- date: AAAA-MM-DD, resolvida a partir da data de hoje. Nunca no futuro.

Enquanto complete=false, entries deve vir vazio.

Em reply, escreva o que dizer à pessoa. Quando completar, faça um resumo de uma frase do que entendeu — a lista aparece na tela e ela ainda confere e edita antes de registrar, então não repita item por item nem números no texto.

Estimar porção por descrição é impreciso e você deve tratar como estimativa, sem fingir exatidão. Não faça diagnóstico, não comente escolhas alimentares nem julgue o que a pessoa comeu, e não use ferramentas.`

var nutritionLogSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"reply":    map[string]any{"type": "string"},
		"complete": map[string]any{"type": "boolean"},
		"entries": map[string]any{
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
					"meal_type":  map[string]any{"type": "string", "enum": []any{"breakfast", "lunch", "dinner", "snack"}},
					"date":       map[string]any{"type": "string"},
				},
				"required":             []any{"food_name", "quantity_g", "calories", "protein_g", "carbs_g", "fat_g", "meal_type", "date"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []any{"reply", "complete", "entries"},
	"additionalProperties": false,
}

type nutritionLogAssistant struct {
	generator StructuredGenerator
}

func NewNutritionLogAssistant(generator StructuredGenerator) NutritionLogAssistant {
	return &nutritionLogAssistant{generator: generator}
}

func (a *nutritionLogAssistant) Next(ctx context.Context, userContext, hoje string, messages []ChatMessage) (*models.NutritionLogDraft, error) {
	var conversa strings.Builder
	fmt.Fprintf(&conversa, "Hoje é %s.\n\nContexto da pessoa: %s\n\nConversa até agora:\n", hoje, userContext)
	for _, m := range messages {
		quem := "Pessoa"
		if m.Role == "assistant" {
			quem = "Você"
		}
		fmt.Fprintf(&conversa, "%s: %s\n", quem, m.Content)
	}
	conversa.WriteString("\nResponda o próximo turno.")

	var draft models.NutritionLogDraft
	if err := a.generator.Generate(ctx, nutritionLogSystemPrompt, conversa.String(), nutritionLogSchema, &draft); err != nil {
		return nil, err
	}
	if strings.TrimSpace(draft.Reply) == "" {
		return nil, fmt.Errorf("assistant returned an empty reply")
	}
	// Um registro sem item não é registro. Deixar `complete` passar com a lista
	// vazia acenderia o botão de registrar para gravar nada.
	if len(draft.Entries) == 0 {
		draft.Complete = false
	}
	if !draft.Complete {
		draft.Entries = nil
	}
	return &draft, nil
}
