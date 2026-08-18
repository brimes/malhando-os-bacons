package models

// NutritionLogDraft é um turno do "modo IA" de registrar refeição: o que
// responder à pessoa e, quando a conversa já deu o suficiente, os registros
// propostos.
//
// Entries só vem preenchido com Complete=true, e nada é gravado aqui: a lista
// vai para a tela, a pessoa confere e é ela quem manda registrar — mesma regra
// da estimativa por foto, pelo mesmo motivo (estimar porção por descrição é
// impreciso).
type NutritionLogDraft struct {
	Reply    string                   `json:"reply"`
	Complete bool                     `json:"complete"`
	Entries  []NutritionLogDraftEntry `json:"entries"`
}

type NutritionLogDraftEntry struct {
	FoodName  string  `json:"food_name"`
	QuantityG float64 `json:"quantity_g"`
	Calories  float64 `json:"calories"`
	ProteinG  float64 `json:"protein_g"`
	CarbsG    float64 `json:"carbs_g"`
	FatG      float64 `json:"fat_g"`
	MealType  string  `json:"meal_type"`
	// Date é AAAA-MM-DD, resolvida pelo assistente a partir de "ontem à noite"
	// e afins. O servidor valida, porque um dia no futuro entraria no histórico
	// e ficaria lá.
	Date string `json:"date"`
}

// NutritionLogAssistantRequest carrega a conversa inteira a cada turno: não há
// tabela para esta thread. Ela é efêmera por natureza — serve para produzir um
// registro e acaba —, e persistir cada tentativa de anotar um lanche encheria o
// banco de conversa que ninguém relê.
type NutritionLogAssistantRequest struct {
	Messages []NutritionLogAssistantMessage `json:"messages"`
}

type NutritionLogAssistantMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
