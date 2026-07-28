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

// OpenCodeGenerator drives a local opencode server, which brokers the actual
// provider. Each call runs in a throwaway session.
type OpenCodeGenerator struct {
	baseURL    string
	providerID string
	modelID    string
	client     *http.Client
}

func NewOpenCodeGenerator(baseURL, model string) (*OpenCodeGenerator, error) {
	providerID, modelID, ok := strings.Cut(model, "/")
	if !ok || providerID == "" || modelID == "" {
		return nil, fmt.Errorf("OPENCODE_MODEL must use provider/model format")
	}
	return &OpenCodeGenerator{
		baseURL:    strings.TrimRight(baseURL, "/"),
		providerID: providerID,
		modelID:    modelID,
		// Generating a full plan takes minutes, and opencode retries the whole
		// generation when the schema does not validate. Callers run this in
		// background, so a long cap is fine.
		client: &http.Client{Timeout: 15 * time.Minute},
	}, nil
}

func (g *OpenCodeGenerator) Generate(ctx context.Context, system, prompt string, schema map[string]any, out any) error {
	sessionID, err := g.createSession(ctx)
	if err != nil {
		return err
	}
	defer g.deleteSession(context.Background(), sessionID)

	body := map[string]any{
		"model":  map[string]string{"providerID": g.providerID, "modelID": g.modelID},
		"system": system,
		"tools":  map[string]bool{"bash": false, "edit": false, "write": false, "read": false, "glob": false, "grep": false, "webfetch": false},
		"parts":  []map[string]string{{"type": "text", "text": prompt}},
		"format": map[string]any{"type": "json_schema", "schema": schema},
	}
	var response struct {
		Info struct {
			Structured json.RawMessage `json:"structured"`
			Error      any             `json:"error"`
		} `json:"info"`
	}
	if err := g.request(ctx, http.MethodPost, "/session/"+sessionID+"/message", body, &response); err != nil {
		return err
	}
	if response.Info.Error != nil || len(response.Info.Structured) == 0 {
		return fmt.Errorf("opencode returned no structured response")
	}
	if err := json.Unmarshal(response.Info.Structured, out); err != nil {
		return fmt.Errorf("decode opencode structured output: %w", err)
	}
	return nil
}

func (g *OpenCodeGenerator) createSession(ctx context.Context) (string, error) {
	var session struct {
		ID string `json:"id"`
	}
	if err := g.request(ctx, http.MethodPost, "/session", map[string]string{"title": "MOB assistant"}, &session); err != nil {
		return "", err
	}
	return session.ID, nil
}

func (g *OpenCodeGenerator) deleteSession(ctx context.Context, sessionID string) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_ = g.request(ctx, http.MethodDelete, "/session/"+sessionID, nil, nil)
}

func (g *OpenCodeGenerator) request(ctx context.Context, method, path string, body, result any) error {
	var payload *bytes.Reader
	if body == nil {
		payload = bytes.NewReader(nil)
	} else {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, g.baseURL+path, payload)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.client.Do(req)
	if err != nil {
		return fmt.Errorf("opencode request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("opencode returned status %d", resp.StatusCode)
	}
	if result != nil {
		return json.NewDecoder(resp.Body).Decode(result)
	}
	return nil
}
