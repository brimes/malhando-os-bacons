package models

// WorkoutChatDraft é um turno do chat de dúvidas do treino: o texto que a
// pessoa lê, mais — quando ela pediu para trocar o exercício ou disse que não
// consegue fazê-lo — a proposta estruturada de substituição. Substitution vem
// nil em qualquer outra dúvida; o schema pedido ao assistente é o que garante
// essa forma, não uma extração separada por cima de texto livre.
type WorkoutChatDraft struct {
	Answer       string                   `json:"answer"`
	Substitution *WorkoutChatSubstitution `json:"substitution"`
}
