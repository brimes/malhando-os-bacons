package services

import "context"

// StructuredGenerator asks an LLM for a JSON answer matching schema and decodes
// it into out. It exists so the assistants below stay independent of which
// provider is configured — see GeminiGenerator and OpenCodeGenerator.
//
// schema is written as plain JSON Schema (nullable fields as {"type":["x","null"]});
// each implementation translates it to the dialect its provider expects.
type StructuredGenerator interface {
	Generate(ctx context.Context, system, prompt string, schema map[string]any, out any) error
}
