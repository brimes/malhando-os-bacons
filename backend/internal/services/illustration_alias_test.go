package services

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/mob/backend/internal/db"
)

// geradorFalso responde a escolha configurada e conta as chamadas.
type geradorFalso struct {
	escolhido string
	err       error
	chamadas  int
	ultimo    string
}

func (g *geradorFalso) Generate(_ context.Context, _ string, prompt string, _ map[string]any, out any) error {
	g.chamadas++
	g.ultimo = prompt
	if g.err != nil {
		return g.err
	}
	r := out.(*respostaAssociador)
	r.Escolhas = []struct {
		Exercicio string `json:"exercicio"`
		Escolhido string `json:"escolhido"`
	}{{Exercicio: "Adutora na Máquina", Escolhido: g.escolhido}}
	return nil
}

var prontas = []IlustracaoCandidata{
	{Chave: "cadeira adutora", Nome: "Cadeira Adutora"},
	{Chave: "cadeira abdutora", Nome: "Cadeira Abdutora"},
	{Chave: "supino reto com barra", Nome: "Supino Reto com Barra"},
	{Chave: "rosca martelo", Nome: "Rosca Martelo"},
}

func TestDecidirEquivalenteEscolhe(t *testing.T) {
	g := &geradorFalso{escolhido: "Cadeira Adutora"}
	chave, perguntou, err := DecidirEquivalente(context.Background(), g, "Adutora na Máquina", prontas)
	if err != nil || !perguntou || chave != "cadeira adutora" {
		t.Fatalf("got (%q,%v,%v)", chave, perguntou, err)
	}
	// A peneira entrega as candidatas parecidas; a que distingue (abdutora)
	// precisa estar à vista do assistente, junto da certa.
	if !strings.Contains(g.ultimo, "Cadeira Adutora") || !strings.Contains(g.ultimo, "Cadeira Abdutora") {
		t.Fatalf("candidatas ausentes do prompt:\n%s", g.ultimo)
	}
}

func TestDecidirEquivalenteRecusa(t *testing.T) {
	g := &geradorFalso{escolhido: ""}
	chave, perguntou, err := DecidirEquivalente(context.Background(), g, "Adutora na Máquina", prontas)
	if err != nil || !perguntou || chave != "" {
		t.Fatalf("got (%q,%v,%v)", chave, perguntou, err)
	}
}

func TestDecidirEquivalenteNomeInventadoViraRecusa(t *testing.T) {
	g := &geradorFalso{escolhido: "Supino Reto com Barra"} // existe, mas não é candidata deste nome
	chave, _, err := DecidirEquivalente(context.Background(), g, "Adutora na Máquina", prontas[:2])
	if err != nil || chave != "" {
		t.Fatalf("got (%q,%v)", chave, err)
	}
}

func TestDecidirEquivalenteSemCandidatasNaoPergunta(t *testing.T) {
	g := &geradorFalso{escolhido: "x"}
	_, perguntou, err := DecidirEquivalente(context.Background(), g, "Adutora na Máquina", nil)
	if err != nil || perguntou || g.chamadas != 0 {
		t.Fatalf("perguntou=%v chamadas=%d err=%v", perguntou, g.chamadas, err)
	}
}

func TestPeneiraLimitaEOrdena(t *testing.T) {
	alvos := make([]alvoCatalogo, len(prontas))
	for i, p := range prontas {
		alvos[i] = novoAlvo(p.Nome)
	}
	idx := peneirar("Adutora na Máquina", alvos, 2)
	if len(idx) != 2 || prontas[idx[0]].Chave != "cadeira adutora" {
		t.Fatalf("índices %v", idx)
	}
}

// Integração com Postgres descartável (nunca o banco com dados reais):
//
//	docker run --rm --network <rede> -e DATABASE_URL=postgres://... mob-gotest \
//	  go test ./internal/services/ -run AliasIntegracao -v
func TestAliasIntegracao(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("sem DATABASE_URL: teste de integração pulado")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	banco, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer banco.Close()
	if err := db.Migrate(ctx, banco, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	limpar := func() {
		_, _ = banco.Pool.Exec(ctx, `DELETE FROM exercise_illustrations WHERE name_key LIKE 'cadeira a%' OR name_key = 'adutora na máquina'`)
	}
	limpar()
	defer limpar()
	for _, p := range prontas[:2] {
		if _, err := banco.Pool.Exec(ctx,
			`INSERT INTO exercise_illustrations (name_key, exercise_name, status, storage_path, content_type, frames, version)
			 VALUES ($1,$2,'ready','p','image/jpeg',4,2)`, p.Chave, p.Nome); err != nil {
			t.Fatal(err)
		}
	}
	a := &IlustracaoAliases{DB: banco, Versao: 2}
	const chave = "adutora na máquina"

	// Falha do assistente: não grava nada, segue para gerar.
	g := &geradorFalso{err: errors.New("fora do ar")}
	if alvo, err := a.Resolver(ctx, g, chave, "Adutora na Máquina"); err != nil || alvo != "" {
		t.Fatalf("falha: (%q,%v)", alvo, err)
	}
	if rec, _ := a.Recusado(ctx, chave); rec {
		t.Fatal("falha do assistente não pode virar recusa")
	}

	// Recusa: gravada, e a segunda vez não pergunta.
	g = &geradorFalso{escolhido: ""}
	if alvo, _ := a.Resolver(ctx, g, chave, "Adutora na Máquina"); alvo != "" || g.chamadas != 1 {
		t.Fatalf("recusa: alvo=%q chamadas=%d", alvo, g.chamadas)
	}
	if alvo, _ := a.Resolver(ctx, g, chave, "Adutora na Máquina"); alvo != "" || g.chamadas != 1 {
		t.Fatalf("recusa cacheada repergunta: chamadas=%d", g.chamadas)
	}
	if _, ok, _ := a.Alvo(ctx, chave); ok {
		t.Fatal("recusa não é alias")
	}

	// Equivalente: grava o alias e o resolve. Limpa a recusa antes (nome novo).
	const chave2 = "cadeira adutora (máquina)"
	g = &geradorFalso{escolhido: "Cadeira Adutora"}
	g2 := &geradorEquiv{inner: g}
	alvo, err := a.Resolver(ctx, g2, chave2, "Cadeira adutora (máquina)")
	if err != nil || alvo != "cadeira adutora" {
		t.Fatalf("alias: (%q,%v)", alvo, err)
	}
	if alvo, ok, _ := a.Alvo(ctx, chave2); !ok || alvo != "cadeira adutora" {
		t.Fatalf("Alvo: (%q,%v)", alvo, ok)
	}
	// Alvo some: o alias vai junto (CASCADE), sem quadro órfão.
	if _, err := banco.Pool.Exec(ctx, `DELETE FROM exercise_illustrations WHERE name_key='cadeira adutora'`); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := a.Alvo(ctx, chave2); ok {
		t.Fatal("alias deveria cair com o alvo")
	}
	_, _ = banco.Pool.Exec(ctx, `DELETE FROM exercise_illustration_aliases WHERE name_key IN ($1,$2)`, chave, chave2)
}

// geradorEquiv responde com o nome do exercício realmente perguntado.
type geradorEquiv struct{ inner *geradorFalso }

func (g *geradorEquiv) Generate(_ context.Context, _ string, prompt string, _ map[string]any, out any) error {
	g.inner.chamadas++
	r := out.(*respostaAssociador)
	r.Escolhas = []struct {
		Exercicio string `json:"exercicio"`
		Escolhido string `json:"escolhido"`
	}{{Exercicio: "Cadeira adutora (máquina)", Escolhido: g.inner.escolhido}}
	return nil
}
