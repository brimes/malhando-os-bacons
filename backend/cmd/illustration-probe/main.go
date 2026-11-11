//go:build probe

// Sonda de diagnóstico da ilustração: usa o MESMO código do servidor
// (descrição + tira + recorte) contra a API real. Fora do build normal: só
// compila com `-tags probe`. Chave por GEMINI_API_KEY (nunca é impressa).
//
//	go run -tags probe ./cmd/illustration-probe <pasta-saida> "Exercício" ...
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mob/backend/internal/services"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "uso: probe <pasta> <exercicio>...")
		os.Exit(2)
	}
	out := os.Args[1]
	gen, err := services.NewGeminiGenerator(os.Getenv("GEMINI_API_KEY"), os.Getenv("GEMINI_MODEL"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	imgModel := os.Getenv("IMAGE_MODEL")
	for _, nome := range os.Args[2:] {
		if err := um(gen, out, nome, imgModel); err != nil {
			fmt.Printf("[%s] ERRO: %v\n", nome, err)
		}
	}
}

func um(gen *services.GeminiGenerator, out, nome, imgModel string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	dir := filepath.Join(out, nome)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if os.Getenv("REUSE") != "" { // só refaz o recorte sobre a tira já salva
		return recortar(dir, nome)
	}
	var desc services.DescricaoMovimento
	if err := gen.Generate(ctx, services.PromptDescricaoMovimento, "Exercise: "+nome,
		services.EsquemaDescricaoMovimento(), &desc); err != nil {
		return fmt.Errorf("descrição: %w", err)
	}
	if err := desc.Normalizar(); err != nil {
		return err
	}
	j, _ := json.MarshalIndent(desc, "", "  ")
	_ = os.WriteFile(filepath.Join(dir, "description.json"), j, 0o644)
	prompt := services.PromptTiraDeQuadros(nome, desc)
	_ = os.WriteFile(filepath.Join(dir, "prompt.txt"), []byte(prompt), 0o644)

	data, mime, err := gen.GenerateImage(ctx, imgModel, prompt, services.ProporcaoTira(desc.Frames))
	if err != nil {
		return fmt.Errorf("imagem: %w", err)
	}
	n := len(data)
	if n > 12 {
		n = 12
	}
	fmt.Printf("[%s] mimeType=%q bytes=%d magic=% x frames=%d aspect=%s\n", nome, mime, len(data), data[:n], desc.Frames, services.ProporcaoTira(desc.Frames))
	ext := "bin"
	switch {
	case strings.Contains(mime, "png"):
		ext = "png"
	case strings.Contains(mime, "jpeg"):
		ext = "jpg"
	case strings.Contains(mime, "webp"):
		ext = "webp"
	}
	_ = os.WriteFile(filepath.Join(dir, "strip."+ext), data, 0o644)
	quadros, err := services.RecortarQuadros(data, desc.Frames)
	if err != nil {
		return fmt.Errorf("recorte: %w", err)
	}
	for i, q := range quadros {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.jpg", i)), q, 0o644); err != nil {
			return err
		}
	}
	fmt.Printf("[%s] %d quadros gravados\n", nome, len(quadros))
	return nil
}

func recortar(dir, nome string) error {
	data, err := os.ReadFile(filepath.Join(dir, "strip.png"))
	if err != nil {
		return err
	}
	var desc services.DescricaoMovimento
	raw, err := os.ReadFile(filepath.Join(dir, "description.json"))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, &desc); err != nil {
		return err
	}
	quadros, err := services.RecortarQuadros(data, desc.Frames)
	if err != nil {
		return fmt.Errorf("recorte: %w", err)
	}
	for i, q := range quadros {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.jpg", i)), q, 0o644); err != nil {
			return err
		}
	}
	fmt.Printf("[%s] %d quadros regravados\n", nome, len(quadros))
	return nil
}
