package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	geminiBaseURL      = "https://generativelanguage.googleapis.com/v1beta"
	geminiDefaultModel = "gemini-3.6-flash"
)

// GeminiGenerator talks to the Gemini API directly, using native structured
// output (responseMimeType + responseSchema) so answers always parse.
type GeminiGenerator struct {
	apiKey string
	model  string
	client *http.Client
}

func NewGeminiGenerator(apiKey, model string) (*GeminiGenerator, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil, fmt.Errorf("GEMINI_API_KEY is required when ASSISTANT_PROVIDER=gemini")
	}
	if strings.TrimSpace(model) == "" {
		model = geminiDefaultModel
	}
	return &GeminiGenerator{
		apiKey: apiKey,
		model:  strings.TrimSpace(model),
		client: &http.Client{Timeout: 10 * time.Minute},
	}, nil
}

func (g *GeminiGenerator) Generate(ctx context.Context, system, prompt string, schema map[string]any, out any) error {
	body := map[string]any{
		"systemInstruction": map[string]any{
			"parts": []map[string]string{{"text": system}},
		},
		"contents": []map[string]any{
			{"role": "user", "parts": []map[string]string{{"text": prompt}}},
		},
		"generationConfig": map[string]any{
			"responseMimeType": "application/json",
			"responseSchema":   toGeminiSchema(schema),
		},
	}
	text, err := g.generateContent(ctx, body)
	if err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(text), out); err != nil {
		return fmt.Errorf("decode gemini structured output: %w", err)
	}
	return nil
}

// Chat answers in free text: same endpoint as Generate, but with no
// responseSchema, so the model writes prose instead of JSON.
func (g *GeminiGenerator) Chat(ctx context.Context, system string, messages []ChatMessage) (string, error) {
	if len(messages) == 0 {
		return "", fmt.Errorf("chat requires at least one message")
	}
	contents := make([]map[string]any, 0, len(messages))
	for _, message := range messages {
		// Gemini calls the assistant turn "model"; everything else is a user turn.
		role := "user"
		if message.Role == "assistant" {
			role = "model"
		}
		contents = append(contents, map[string]any{
			"role":  role,
			"parts": []map[string]string{{"text": message.Content}},
		})
	}
	body := map[string]any{
		"systemInstruction": map[string]any{
			"parts": []map[string]string{{"text": system}},
		},
		"contents": contents,
	}
	return g.generateContent(ctx, body)
}

// generateContent posts one request and returns the answer as plain text.
// Shared by Generate and Chat so both handle blocked prompts, truncated answers
// and empty candidates the same way.
func (g *GeminiGenerator) generateContent(ctx context.Context, body map[string]any) (string, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	url := fmt.Sprintf("%s/models/%s:generateContent", geminiBaseURL, g.model)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	// The key goes in a header rather than the query string so it never lands in logs.
	req.Header.Set("x-goog-api-key", g.apiKey)

	resp, err := g.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("gemini request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("gemini returned status %d", resp.StatusCode)
	}

	var response struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		PromptFeedback struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return "", fmt.Errorf("decode gemini response: %w", err)
	}
	if response.PromptFeedback.BlockReason != "" {
		return "", fmt.Errorf("gemini blocked the prompt: %s", response.PromptFeedback.BlockReason)
	}
	if len(response.Candidates) == 0 {
		return "", fmt.Errorf("gemini returned no candidates")
	}
	candidate := response.Candidates[0]
	// Anything other than STOP means the answer is cut short — as structured
	// output it would not even parse.
	if candidate.FinishReason != "" && candidate.FinishReason != "STOP" {
		return "", fmt.Errorf("gemini stopped early: %s", candidate.FinishReason)
	}
	var text strings.Builder
	for _, part := range candidate.Content.Parts {
		text.WriteString(part.Text)
	}
	if strings.TrimSpace(text.String()) == "" {
		return "", fmt.Errorf("gemini returned an empty response")
	}
	return text.String(), nil
}

// ValidateGeminiAPIKey checks a key against the cheapest call the API offers,
// listing the available models. A key is only ever saved after this passes:
// otherwise the first sign of a wrong key would be a plan generation failing
// minutes later, with nothing pointing back at the key.
//
// The returned errors are shown to the user, so they are in Portuguese. The key
// itself is never logged nor echoed back.
func ValidateGeminiAPIKey(ctx context.Context, apiKey string) error {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return fmt.Errorf("informe a chave da API")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, geminiBaseURL+"/models", nil)
	if err != nil {
		return fmt.Errorf("não foi possível validar a chave agora; tente novamente")
	}
	req.Header.Set("x-goog-api-key", apiKey)

	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("não foi possível falar com o Gemini para validar a chave; verifique a conexão e tente novamente")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnauthorized ||
		resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("o Gemini recusou essa chave; confira se ela está ativa e com a API Generative Language habilitada")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("o Gemini respondeu com erro %d ao validar a chave; tente de novo em alguns minutos", resp.StatusCode)
	}
	return nil
}

// toGeminiSchema rewrites plain JSON Schema into the OpenAPI subset Gemini
// accepts: no additionalProperties, a single "type" per node, and nullability
// expressed as a "nullable" flag instead of a ["x","null"] union.
func toGeminiSchema(schema map[string]any) map[string]any {
	result := make(map[string]any, len(schema))
	nullable := false

	for key, value := range schema {
		switch key {
		case "additionalProperties":
			// Not supported by Gemini; the schema is closed by construction anyway.
		case "type":
			single, isNullable := splitNullableType(value)
			nullable = nullable || isNullable
			result["type"] = single
		case "enum":
			options, isNullable := splitNullableEnum(value)
			nullable = nullable || isNullable
			if len(options) > 0 {
				result["enum"] = options
			}
		case "properties":
			properties, ok := value.(map[string]any)
			if !ok {
				result[key] = value
				continue
			}
			converted := make(map[string]any, len(properties))
			for name, property := range properties {
				converted[name] = convertSchemaValue(property)
			}
			result["properties"] = converted
		case "items":
			result["items"] = convertSchemaValue(value)
		default:
			result[key] = value
		}
	}
	if nullable {
		result["nullable"] = true
	}
	// A nullable field may legitimately be absent, so drop those from "required"
	// rather than forcing the model to emit an explicit null.
	if required, ok := result["required"]; ok {
		if properties, hasProperties := result["properties"].(map[string]any); hasProperties {
			result["required"] = filterRequired(required, properties)
		}
	}
	return result
}

func convertSchemaValue(value any) any {
	if nested, ok := value.(map[string]any); ok {
		return toGeminiSchema(nested)
	}
	return value
}

// splitNullableType turns "string" or ["string","null"] into ("string", isNullable).
func splitNullableType(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return typed, false
	case []string:
		return firstNonNull(typed)
	case []any:
		names := make([]string, 0, len(typed))
		for _, item := range typed {
			if name, ok := item.(string); ok {
				names = append(names, name)
			}
		}
		return firstNonNull(names)
	}
	return "string", false
}

func firstNonNull(names []string) (string, bool) {
	chosen := ""
	nullable := false
	for _, name := range names {
		if name == "null" {
			nullable = true
			continue
		}
		if chosen == "" {
			chosen = name
		}
	}
	if chosen == "" {
		chosen = "string"
	}
	return chosen, nullable
}

// splitNullableEnum drops a nil entry from an enum, reporting it as nullability.
func splitNullableEnum(value any) ([]string, bool) {
	items, ok := value.([]any)
	if !ok {
		if names, isStrings := value.([]string); isStrings {
			return names, false
		}
		return nil, false
	}
	options := make([]string, 0, len(items))
	nullable := false
	for _, item := range items {
		if item == nil {
			nullable = true
			continue
		}
		if name, isString := item.(string); isString {
			options = append(options, name)
		}
	}
	return options, nullable
}

func filterRequired(required any, properties map[string]any) []string {
	var names []string
	switch typed := required.(type) {
	case []string:
		names = typed
	case []any:
		for _, item := range typed {
			if name, ok := item.(string); ok {
				names = append(names, name)
			}
		}
	default:
		return nil
	}
	kept := make([]string, 0, len(names))
	for _, name := range names {
		if property, ok := properties[name].(map[string]any); ok {
			if isNullable, _ := property["nullable"].(bool); isNullable {
				continue
			}
		}
		kept = append(kept, name)
	}
	return kept
}
