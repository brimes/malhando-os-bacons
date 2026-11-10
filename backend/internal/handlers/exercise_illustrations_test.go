package handlers

import (
	"bytes"
	"image"
	"image/png"
	"testing"

	"github.com/mob/backend/internal/models"
)

func TestChaveIlustracao(t *testing.T) {
	if chaveIlustracao("  Supino   Reto ") != chaveIlustracao("supino reto") {
		t.Fatal("chave deve ignorar caixa e espaços repetidos")
	}
}

func TestStatusDoVideo(t *testing.T) {
	none, llm := "none", "llm"
	if statusDoVideo(nil, &none) != "not_found" {
		t.Fatal("recusa gravada deve virar not_found")
	}
	if statusDoVideo(nil, nil) != "" {
		t.Fatal("sem associação ainda não é not_found")
	}
	if statusDoVideo(&models.ExerciseVideo{}, &llm) != "" {
		t.Fatal("com vídeo não é not_found")
	}
}

func TestComprimirImagem(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 600, 600))); err != nil {
		t.Fatal(err)
	}
	_, mime := comprimirImagem(buf.Bytes(), "image/png")
	if mime != "image/jpeg" && mime != "image/png" {
		t.Fatalf("mime inesperado %s", mime)
	}
	if out, m := comprimirImagem([]byte("lixo"), "image/png"); string(out) != "lixo" || m != "image/png" {
		t.Fatal("dado inválido deve voltar intacto")
	}
}
