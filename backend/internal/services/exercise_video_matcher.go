package services

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/mob/backend/internal/db"
)

// O associador liga o nome de exercício que o assistente escreveu ao nome do
// catálogo de vídeos, que é um conjunto fechado de 963 nomes fixos.
//
// Por que ele precisa existir: os dois vocabulários não coincidem. Medido
// contra o banco real, 2 de 32 nomes distintos casavam exatamente.
//
// Por que em dois estágios, e não só por semelhança de texto: uma primeira
// tentativa puramente heurística casou "Supino Reto com Barra" com "Supino com
// barra declinado" e "Crucifixo Invertido no Pec Deck" (posterior de ombro)
// com "Voador no pec deck" (peitoral) — com pontuação alta, porque a palavra
// que distingue é justamente a que toda normalização descarta. Mostrar o
// movimento errado para quem está com peso na mão é pior que não mostrar nada.
//
//   - Estágio 1 (CandidatosCatalogo, determinístico): reduz 963 nomes a ~10
//     candidatos. Custo zero de LLM, e o critério é abrangência, não acerto.
//   - Estágio 2 (aqui): uma chamada ao assistente vendo SÓ esses candidatos,
//     com permissão explícita de recusar todos. É o que separa "reto" de
//     "declinado". Passar os 963 nomes resolveria também, mas custa tokens em
//     toda geração de plano, sem ganho sobre a lista curta.
//
// O resultado é gravado em `exercise_video_links` com o nome como chave, e a
// recusa também é gravada: sem isso, todo plano reabriria a busca do zero e
// pagaria a chamada de novo, para sempre, pelo mesmo nome.
type ExerciseVideoMatcher interface {
	// EnsureLinks resolve os nomes que ainda não têm vínculo. É idempotente e
	// pode ser chamada com nomes repetidos ou já resolvidos.
	EnsureLinks(ctx context.Context, userID int64, names []string) error

	// BackfillKnownNames resolve os nomes já gravados no banco que ainda não
	// têm vínculo — planos e histórico anteriores a este recurso, e qualquer
	// nome cuja associação tenha falhado antes.
	BackfillKnownNames(ctx context.Context) error
}

const candidatosPorExercicio = 10

// Quantos nomes vão numa chamada só. O prompt cresce com o número de nomes
// vezes os candidatos de cada um; 25 mantém a requisição pequena o bastante
// para não arriscar corte de resposta, e um plano inteiro raramente passa
// disso — 7 dias de 9 exercícios dá 63 nomes, quase todos já em cache.
const nomesPorChamada = 25

const promptAssociador = `Você liga o nome de um exercício de academia, escrito livremente, ao nome correspondente numa lista fechada de vídeos demonstrativos.

Para cada exercício, escolha da lista de candidatos o nome que mostra O MESMO MOVIMENTO. Responda com o nome do candidato copiado exatamente como aparece na lista.

Regras que importam mais que cobrir todos os itens:

- Só escolha se for o mesmo exercício de verdade. Variações que mudam o músculo trabalhado ou o ângulo do movimento são exercícios DIFERENTES: supino reto não é supino inclinado nem declinado; crucifixo invertido (posterior de ombro) não é voador/crucifixo comum (peitoral); rosca direta não é rosca martelo; cadeira extensora não é cadeira flexora.
- Diferenças que NÃO impedem a escolha, porque o movimento é o mesmo: sinônimos regionais (gêmeos/panturrilha, pulley/polia, elíptico/transport), o aparelho dito de formas diferentes, palavras de contexto que não descrevem o movimento ("aquecimento em esteira" é esteira), e detalhes ausentes de um lado só (unilateral, pegada, banco) quando nenhum candidato traz o detalhe.
- Se nenhum candidato for o mesmo movimento, responda com string vazia. Recusar é a resposta certa com frequência e não é falha: vídeo errado engana quem está treinando, vídeo ausente só não ajuda.
- Nunca invente um nome que não esteja entre os candidatos daquele exercício.`

var esquemaAssociador = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"escolhas": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"exercicio": map[string]any{"type": "string"},
					"escolhido": map[string]any{"type": "string"},
				},
				"required":             []any{"exercicio", "escolhido"},
				"additionalProperties": false,
			},
		},
	},
	"required":             []any{"escolhas"},
	"additionalProperties": false,
}

type respostaAssociador struct {
	Escolhas []struct {
		Exercicio string `json:"exercicio"`
		Escolhido string `json:"escolhido"`
	} `json:"escolhas"`
}

type exerciseVideoMatcher struct {
	db       *db.DB
	resolver GeneratorResolver
}

func NewExerciseVideoMatcher(database *db.DB, resolver GeneratorResolver) ExerciseVideoMatcher {
	return &exerciseVideoMatcher{db: database, resolver: resolver}
}

func (m *exerciseVideoMatcher) EnsureLinks(ctx context.Context, userID int64, names []string) error {
	pendentes, err := m.filtrarPendentes(ctx, names)
	if err != nil {
		return err
	}
	if len(pendentes) == 0 {
		return nil
	}

	// Atalho antes de gastar qualquer token: o assistente às vezes escreve um
	// nome que já é do catálogo. Grava como 'exact', que é mais confiável que
	// qualquer escolha do LLM e nunca precisa ser revisto.
	restantes := pendentes[:0:0]
	for _, nome := range pendentes {
		if entrada, ok := CatalogoPorNome(nome); ok {
			if err := m.gravar(ctx, nome, &entrada, "exact"); err != nil {
				return err
			}
			continue
		}
		restantes = append(restantes, nome)
	}
	if len(restantes) == 0 {
		return nil
	}

	generator := m.resolver.For(ctx, userID)
	for inicio := 0; inicio < len(restantes); inicio += nomesPorChamada {
		fim := min(inicio+nomesPorChamada, len(restantes))
		if err := m.resolverLote(ctx, generator, restantes[inicio:fim]); err != nil {
			// Falha do assistente não pode derrubar a geração do plano: o plano
			// vale sem vídeo, e o nome fica pendente para a próxima tentativa
			// justamente por não ter sido gravado.
			slog.Error("falha ao associar vídeos de exercício", "erro", err, "nomes", len(restantes[inicio:fim]))
			return err
		}
	}
	return nil
}

// BackfillKnownNames resolve o que já está no banco e ainda não tem vínculo.
//
// Sem isto, o recurso só valeria para planos criados depois dele: os exercícios
// que a pessoa já treina ficariam sem vídeo até ela gerar um plano novo, que é
// exatamente o contrário do que se espera ao instalar a atualização.
//
// Roda no boot. Converge numa passada porque a recusa também é gravada — a
// segunda execução encontra tudo resolvido e não passa de um SELECT. Sem
// usuário associado, então usa o crédito compartilhado.
func (m *exerciseVideoMatcher) BackfillKnownNames(ctx context.Context) error {
	rows, err := m.db.Pool.Query(ctx,
		`SELECT nome FROM (
		     SELECT DISTINCT exercise_name AS nome FROM training_plan_exercises
		     UNION
		     SELECT DISTINCT exercise_name AS nome FROM workout_sets
		 ) nomes
		 WHERE nome <> '' AND NOT EXISTS (
		     SELECT 1 FROM exercise_video_links v WHERE v.exercise_name = nomes.nome
		 )
		 ORDER BY nome`)
	if err != nil {
		return fmt.Errorf("listar nomes sem vínculo: %w", err)
	}
	defer rows.Close()

	var nomes []string
	for rows.Next() {
		var nome string
		if err := rows.Scan(&nome); err != nil {
			return err
		}
		nomes = append(nomes, nome)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(nomes) == 0 {
		return nil
	}

	slog.Info("associando vídeos de exercícios já existentes", "nomes", len(nomes))
	if err := m.EnsureLinks(ctx, 0, nomes); err != nil {
		return err
	}
	slog.Info("associação de vídeos concluída", "nomes", len(nomes))
	return nil
}

// filtrarPendentes remove duplicatas, vazios e o que já tem vínculo gravado
// (inclusive os vínculos vazios: "já procuramos e não existe" é resposta).
func (m *exerciseVideoMatcher) filtrarPendentes(ctx context.Context, names []string) ([]string, error) {
	unicos := make([]string, 0, len(names))
	vistos := make(map[string]struct{}, len(names))
	for _, nome := range names {
		nome = strings.TrimSpace(nome)
		if nome == "" {
			continue
		}
		if _, ok := vistos[nome]; ok {
			continue
		}
		vistos[nome] = struct{}{}
		unicos = append(unicos, nome)
	}
	if len(unicos) == 0 {
		return nil, nil
	}

	rows, err := m.db.Pool.Query(ctx,
		`SELECT exercise_name FROM exercise_video_links WHERE exercise_name = ANY($1)`, unicos)
	if err != nil {
		return nil, fmt.Errorf("consultar vínculos existentes: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var nome string
		if err := rows.Scan(&nome); err != nil {
			return nil, err
		}
		delete(vistos, nome)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	pendentes := make([]string, 0, len(vistos))
	for _, nome := range unicos {
		if _, ainda := vistos[nome]; ainda {
			pendentes = append(pendentes, nome)
		}
	}
	return pendentes, nil
}

func (m *exerciseVideoMatcher) resolverLote(ctx context.Context, generator StructuredGenerator, nomes []string) error {
	candidatosPorNome := make(map[string][]ExercicioCatalogo, len(nomes))
	var prompt strings.Builder
	comCandidatos := 0
	for _, nome := range nomes {
		candidatos := CandidatosCatalogo(nome, candidatosPorExercicio)
		candidatosPorNome[nome] = candidatos
		if len(candidatos) == 0 {
			continue
		}
		comCandidatos++
		fmt.Fprintf(&prompt, "\nExercício: %s\nCandidatos:\n", nome)
		for _, c := range candidatos {
			fmt.Fprintf(&prompt, "  - %s\n", c.Nome)
		}
	}

	// Nenhum nome teve candidato: não há o que perguntar. Grava a recusa para
	// não repetir a busca.
	if comCandidatos == 0 {
		for _, nome := range nomes {
			if err := m.gravar(ctx, nome, nil, "none"); err != nil {
				return err
			}
		}
		return nil
	}

	var resposta respostaAssociador
	if err := generator.Generate(ctx, promptAssociador, prompt.String(), esquemaAssociador, &resposta); err != nil {
		return fmt.Errorf("assistente: %w", err)
	}

	escolhaPorNome := make(map[string]string, len(resposta.Escolhas))
	for _, e := range resposta.Escolhas {
		escolhaPorNome[e.Exercicio] = strings.TrimSpace(e.Escolhido)
	}

	for _, nome := range nomes {
		escolhido := escolhaPorNome[nome]
		if escolhido == "" {
			if err := m.gravar(ctx, nome, nil, "none"); err != nil {
				return err
			}
			continue
		}

		// O nome escolhido tem de ser um dos candidatos DAQUELE exercício. Um
		// modelo que alucina um nome plausível, ou que reaproveita o candidato
		// de outro item do lote, produziria um vínculo que aponta para o vídeo
		// errado — e nada depois disso perceberia.
		entrada, valido := ExercicioCatalogo{}, false
		for _, c := range candidatosPorNome[nome] {
			if c.Nome == escolhido {
				entrada, valido = c, true
				break
			}
		}
		if !valido {
			slog.Warn("assistente escolheu nome fora dos candidatos",
				"exercicio", nome, "escolhido", escolhido)
			if err := m.gravar(ctx, nome, nil, "none"); err != nil {
				return err
			}
			continue
		}
		if err := m.gravar(ctx, nome, &entrada, "llm"); err != nil {
			return err
		}
	}
	return nil
}

// gravar persiste o vínculo. entrada nil registra "procuramos e não existe".
//
// O ON CONFLICT não sobrescreve um vínculo 'manual': se alguém corrigiu um
// vínculo a dedo, uma regeração não pode desfazer a correção.
func (m *exerciseVideoMatcher) gravar(ctx context.Context, nome string, entrada *ExercicioCatalogo, metodo string) error {
	var catalogo, webm, mp4 *string
	if entrada != nil {
		catalogo, webm, mp4 = &entrada.Nome, &entrada.WebM, &entrada.MP4
	}
	_, err := m.db.Pool.Exec(ctx,
		`INSERT INTO exercise_video_links (exercise_name, catalog_name, object_webm, object_mp4, resolved_by)
		 VALUES ($1,$2,$3,$4,$5)
		 ON CONFLICT (exercise_name) DO UPDATE
		   SET catalog_name = EXCLUDED.catalog_name,
		       object_webm  = EXCLUDED.object_webm,
		       object_mp4   = EXCLUDED.object_mp4,
		       resolved_by  = EXCLUDED.resolved_by,
		       updated_at   = NOW()
		 WHERE exercise_video_links.resolved_by <> 'manual'`,
		nome, catalogo, webm, mp4, metodo)
	if err != nil {
		return fmt.Errorf("gravar vínculo de %q: %w", nome, err)
	}
	return nil
}
