package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// ErrImageNotSupported significa que o provedor em uso não gera imagem (é o
// caso do opencode). Quem chama decide se cai para outra credencial.
var ErrImageNotSupported = errors.New("the configured assistant provider does not generate images")

// GeminiDefaultImageModel é o modelo de imagem do Gemini, acessível com a mesma
// API key dos modelos de texto.
const GeminiDefaultImageModel = "gemini-2.5-flash-image"

// ImageGenerator é implementado só por provedores que geram imagem. Separado
// de StructuredGenerator pelo mesmo motivo de VisionGenerator: um provedor que
// não gera imagem segue compilando e quem chama degrada para
// ErrImageNotSupported.
type ImageGenerator interface {
	GenerateImage(ctx context.Context, model, prompt, aspectRatio string) (data []byte, mimeType string, err error)
}

// GenerateImage pede uma imagem ao modelo `model` e devolve os bytes.
//
// O modelo de imagem é outro (não o de texto do gerador), então é parâmetro.
// A chave vai no header, como no resto do arquivo, para nunca cair em log.
func (g *GeminiGenerator) GenerateImage(ctx context.Context, model, prompt, aspectRatio string) ([]byte, string, error) {
	if strings.TrimSpace(model) == "" {
		model = GeminiDefaultImageModel
	}
	generationConfig := map[string]any{"responseModalities": []string{"IMAGE"}}
	// Proporção da imagem inteira (ex.: "21:9"): a tira de quadros precisa ser
	// larga, e o padrão do modelo é quadrado.
	if strings.TrimSpace(aspectRatio) != "" {
		generationConfig["imageConfig"] = map[string]any{"aspectRatio": aspectRatio}
	}
	body := map[string]any{
		"contents": []map[string]any{
			{"role": "user", "parts": []map[string]string{{"text": prompt}}},
		},
		"generationConfig": generationConfig,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, "", err
	}
	url := fmt.Sprintf("%s/models/%s:generateContent", geminiBaseURL, model)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", g.apiKey)

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("gemini image request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("gemini image returned status %d", resp.StatusCode)
	}

	var response struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					InlineData struct {
						MimeType string `json:"mimeType"`
						Data     string `json:"data"`
					} `json:"inlineData"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		PromptFeedback struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, "", fmt.Errorf("decode gemini image response: %w", err)
	}
	if response.PromptFeedback.BlockReason != "" {
		return nil, "", fmt.Errorf("gemini blocked the image prompt: %s", response.PromptFeedback.BlockReason)
	}
	for _, candidate := range response.Candidates {
		for _, part := range candidate.Content.Parts {
			if part.InlineData.Data == "" {
				continue
			}
			data, err := base64.StdEncoding.DecodeString(part.InlineData.Data)
			if err != nil {
				return nil, "", fmt.Errorf("decode gemini image data: %w", err)
			}
			mimeType := part.InlineData.MimeType
			if mimeType == "" {
				mimeType = "image/png"
			}
			return data, mimeType, nil
		}
	}
	return nil, "", fmt.Errorf("gemini returned no image")
}
