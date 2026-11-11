package handlers

import (
	"net/http/httptest"
	"testing"
	"time"

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

func TestStatusDaLinha(t *testing.T) {
	agora := time.Now()
	if statusDaLinha("ready", 1, agora, agora) != "outdated" {
		t.Fatal("pronta de versão antiga deve ser outdated")
	}
	if statusDaLinha("ready", versaoIlustracao, agora, agora) != "ready" {
		t.Fatal("pronta atual deve ser ready")
	}
	if statusDaLinha("pending", 1, agora.Add(-validadePendente-time.Second), agora) != "failed" {
		t.Fatal("pendente órfã deve virar failed")
	}
	if statusDaLinha("pending", 1, agora, agora) != "pending" {
		t.Fatal("pendente recente segue pending")
	}
}

func TestCotaEsgotada(t *testing.T) {
	if cotaEsgotada(limiteIlustracoesPorDia - 1) {
		t.Fatal("abaixo do limite não esgota")
	}
	if !cotaEsgotada(limiteIlustracoesPorDia) {
		t.Fatal("no limite esgota (regenerate recusa com 429)")
	}
}

func TestQuadroDaQuery(t *testing.T) {
	casos := map[string]struct {
		i  int
		ok bool
	}{"": {0, true}, "2": {2, true}, "3": {3, true}, "4": {0, false}, "-1": {0, false}, "x": {0, false}}
	for q, esperado := range casos {
		r := httptest.NewRequest("GET", "/?name=a&frame="+q, nil)
		if q == "" {
			r = httptest.NewRequest("GET", "/?name=a", nil)
		}
		i, ok := quadroDaQuery(r)
		if i != esperado.i || ok != esperado.ok {
			t.Fatalf("frame=%q: got (%d,%v)", q, i, ok)
		}
	}
}

func TestImageRecusaQuadroInvalido(t *testing.T) {
	h := &ExerciseIllustrationHandler{} // índice inválido responde antes de tocar no banco
	w := httptest.NewRecorder()
	h.Image(w, httptest.NewRequest("GET", "/?name=Cadeira+Adutora&frame=abc", nil))
	if w.Code != 400 {
		t.Fatalf("status %d, esperado 400", w.Code)
	}
}
