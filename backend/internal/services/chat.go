package services

import (
	"context"
	"errors"
)

// ErrChatNotSupported means the configured provider only knows how to produce
// structured output. Callers turn it into a message for the user instead of a
// generic failure.
var ErrChatNotSupported = errors.New("the configured assistant provider does not support free-text chat")

// ChatMessage is one turn of a free-text conversation. Role is "user" or
// "assistant"; each provider maps it to whatever name it expects.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatGenerator asks an LLM for a plain-text answer. It is separate from
// StructuredGenerator because the two are not interchangeable: a structured
// call always forces a JSON schema, which is exactly what a conversation must
// not do. Providers that can do both implement both interfaces.
type ChatGenerator interface {
	Chat(ctx context.Context, system string, messages []ChatMessage) (string, error)
}
