package services

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/mob/backend/internal/db"
)

// Teste de integração do associador: banco de verdade e assistente de verdade.
//
// Fica separado dos testes de unidade porque é o único jeito de saber se o
// estágio 2 funciona — a escolha entre "Supino Reto" e "Supino declinado" é
// exatamente o que nenhum teste sem LLM consegue exercitar. Custa tokens e
// exige rede, então só roda quando DATABASE_URL e a chave estão presentes:
//
//	docker run --rm --network malhando-os-bacons_default \
//	  -e DATABASE_URL=... -e GEMINI_API_KEY=... mob-gotest \
//	  go test ./internal/services/ -run Integracao -v
//
// Não escreve em nenhuma tabela de usuário: só em exercise_video_links, que é
// cache global por nome e cuja repopulação é o próprio objetivo.
func TestAssociadorIntegracao(t *testing.T) {
	urlBanco := os.Getenv("DATABASE_URL")
	chave := os.Getenv("GEMINI_API_KEY")
	if urlBanco == "" || chave == "" {
		t.Skip("sem DATABASE_URL e GEMINI_API_KEY: teste de integração pulado")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	banco, err := db.Connect(ctx, urlBanco)
	if err != nil {
		t.Fatalf("conectar ao banco: %v", err)
	}
	defer banco.Close()

	gerador, err := NewGeminiGenerator(chave, os.Getenv("GEMINI_MODEL"))
	if err != nil {
		t.Fatalf("gerador: %v", err)
	}
	matcher := NewExerciseVideoMatcher(banco, NewGeneratorResolver(banco, gerador, os.Getenv("GEMINI_MODEL")))

	// Os nomes reais gravados no banco, e o que se espera de cada um. O que
	// está em branco é onde recusar É a resposta certa: o catálogo não tem
	// prancha isométrica nem abdominal na bicicleta, e inventar um vínculo ali
	// mostraria o movimento errado para quem está treinando.
	casos := []struct {
		nome     string
		esperado string
	}{
		{"Supino Reto com Barra", "Supino Reto"},
		{"Agachamento Livre com Barra", "Agachamento Barra"},
		{"Cadeira Extensora", "Cadeira extensora"},
		{"Mesa Flexora", "Mesa flexora"},
		{"Stiff com Barra", "Stiff com barra"},
		{"Puxada Alta pela Frente", "Puxada Alta"},
		{"Leg Press 45°", "Leg Press"},
		{"Tríceps Pulley com Corda", "Tríceps pulley corda"},
		{"Aquecimento na Esteira com Inclinação", "Esteira com Inclinação"},
		{"Prancha Abdominal Isométrica", ""},
	}

	nomes := make([]string, 0, len(casos))
	for _, c := range casos {
		nomes = append(nomes, c.nome)
	}

	// Reprocessa do zero: sem isto o teste passaria lendo o cache de uma
	// execução anterior e nunca exercitaria o assistente.
	if _, err := banco.Pool.Exec(ctx,
		`DELETE FROM exercise_video_links WHERE exercise_name = ANY($1) AND resolved_by <> 'manual'`,
		nomes); err != nil {
		t.Fatalf("limpar vínculos: %v", err)
	}

	if err := matcher.EnsureLinks(ctx, 1, nomes); err != nil {
		t.Fatalf("EnsureLinks: %v", err)
	}

	acertos := 0
	for _, caso := range casos {
		var catalogo *string
		var metodo string
		err := banco.Pool.QueryRow(ctx,
			`SELECT catalog_name, resolved_by FROM exercise_video_links WHERE exercise_name=$1`,
			caso.nome).Scan(&catalogo, &metodo)
		if err != nil {
			t.Errorf("%q: nenhum vínculo gravado (%v)", caso.nome, err)
			continue
		}
		obtido := ""
		if catalogo != nil {
			obtido = *catalogo
		}
		if obtido == caso.esperado {
			acertos++
			t.Logf("ok   %-40q -> %q (%s)", caso.nome, obtido, metodo)
		} else {
			t.Errorf("erro %-40q -> %q, esperado %q (%s)", caso.nome, obtido, caso.esperado, metodo)
		}
	}
	t.Logf("%d/%d corretos", acertos, len(casos))
}

// Reexecutar não pode custar tokens nem chamar o assistente de novo: o cache
// por nome é o que impede a mesma pergunta de ser paga para sempre.
func TestAssociadorNaoRefazTrabalho(t *testing.T) {
	urlBanco := os.Getenv("DATABASE_URL")
	if urlBanco == "" {
		t.Skip("sem DATABASE_URL: teste de integração pulado")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	banco, err := db.Connect(ctx, urlBanco)
	if err != nil {
		t.Fatalf("conectar ao banco: %v", err)
	}
	defer banco.Close()

	// Um gerador que explode se for chamado: se o cache falhar, o teste falha
	// com uma mensagem que diz exatamente o que aconteceu.
	matcher := NewExerciseVideoMatcher(banco, NewGeneratorResolver(banco, geradorProibido{t: t}, ""))

	nome := "Exercício inventado para o teste de cache"
	if _, err := banco.Pool.Exec(ctx,
		`INSERT INTO exercise_video_links (exercise_name, resolved_by) VALUES ($1,'none')
		 ON CONFLICT (exercise_name) DO NOTHING`, nome); err != nil {
		t.Fatalf("preparar vínculo: %v", err)
	}
	defer banco.Pool.Exec(ctx, `DELETE FROM exercise_video_links WHERE exercise_name=$1`, nome)

	if err := matcher.EnsureLinks(ctx, 1, []string{nome, nome}); err != nil {
		t.Fatalf("EnsureLinks: %v", err)
	}
}

type geradorProibido struct{ t *testing.T }

func (g geradorProibido) Generate(context.Context, string, string, map[string]any, any) error {
	g.t.Error("o assistente foi chamado para um nome que já tinha vínculo gravado")
	return nil
}
