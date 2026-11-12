package services

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/db"
)

// Reaproveitamento de ilustração por equivalência.
//
// O assistente escreve o mesmo exercício de várias formas ("Cadeira Adutora",
// "Adutora na Máquina", "Cadeira adutora (máquina)") e cada grafia ganharia a
// própria imagem paga. Aqui, antes de gerar, o nome é comparado com as
// ilustrações já prontas — pelo mesmo associador em dois estágios dos vídeos:
// peneira determinística (peneirar) e escolha do assistente (escolherEntre),
// com permissão de recusar. Equivalente: grava um alias, sem copiar arquivo.
//
// Todo o risco é o do matcher de vídeo: variação de inclinação, pegada,
// unilateral/bilateral, máquina vs livre ou ângulo é outro exercício, e um
// desenho trocado engana tanto quanto um vídeo trocado.

const promptEquivalencia = `Você decide se um exercício de academia, escrito livremente, é O MESMO exercício de algum dos já ilustrados na lista de candidatos, para reaproveitar a mesma ilustração. Responda com o nome do candidato copiado exatamente como aparece na lista.

Regras que importam mais que cobrir todos os itens:

- Só escolha se for o mesmo exercício de verdade, com o mesmo aparelho e o mesmo movimento. Variações são exercícios DIFERENTES: inclinação do banco (supino reto não é inclinado nem declinado), pegada (supinada, pronada, neutra, aberta, fechada), unilateral versus bilateral, máquina versus peso livre ou polia, ângulo do movimento, e músculo trabalhado (crucifixo invertido não é voador; cadeira extensora não é flexora; rosca direta não é martelo).
- Diferenças que NÃO impedem a escolha: sinônimos e grafias do mesmo nome (gêmeos/panturrilha, pulley/polia), a palavra "máquina" ou "na máquina" quando o aparelho é o mesmo, ordem das palavras, parênteses, acentos e plural.
- Se nenhum candidato for exatamente o mesmo exercício, responda com string vazia. Recusar é a resposta certa com frequência e não é falha: gerar uma ilustração nova só custa uma imagem, enquanto reaproveitar a errada mostra o movimento errado.
- Nunca invente um nome que não esteja entre os candidatos daquele exercício.`

// IlustracaoCandidata é uma ilustração pronta que pode ser reaproveitada.
type IlustracaoCandidata struct {
	Chave string // name_key
	Nome  string // exercise_name, o que o assistente enxerga
}

// DecidirEquivalente é o associador puro (sem banco): peneira as candidatas e
// pergunta ao assistente. Devolve a chave da escolhida, "" se ele recusou, e
// perguntou=false quando nem havia o que perguntar (nenhuma candidata passou
// da peneira) — caso em que nada deve ser gravado como recusa.
func DecidirEquivalente(ctx context.Context, generator StructuredGenerator, nome string, candidatas []IlustracaoCandidata) (chave string, perguntou bool, err error) {
	alvos := make([]alvoCatalogo, len(candidatas))
	for i, c := range candidatas {
		alvos[i] = novoAlvo(c.Nome)
	}
	indices := peneirar(nome, alvos, candidatosPorExercicio)
	if len(indices) == 0 {
		return "", false, nil
	}
	nomes := make([]string, 0, len(indices))
	chavePorNome := make(map[string]string, len(indices))
	for _, i := range indices {
		if _, dup := chavePorNome[candidatas[i].Nome]; dup {
			continue
		}
		nomes = append(nomes, candidatas[i].Nome)
		chavePorNome[candidatas[i].Nome] = candidatas[i].Chave
	}
	escolhas, err := escolherEntre(ctx, generator, promptEquivalencia,
		[]string{nome}, map[string][]string{nome: nomes})
	if err != nil {
		return "", true, err
	}
	return chavePorNome[escolhas[nome]], true, nil
}

// IlustracaoAliases guarda e consulta os vínculos entre nomes.
type IlustracaoAliases struct {
	DB *db.DB
	// Versao é a versão atual da ilustração: só as prontas nela são candidatas
	// (uma desatualizada vai ser regenerada e não é referência confiável).
	Versao int
}

// Alvo devolve a chave da ilustração que o nome usa, se houver alias.
func (a *IlustracaoAliases) Alvo(ctx context.Context, chave string) (string, bool, error) {
	var alvo *string
	err := a.DB.Pool.QueryRow(ctx,
		`SELECT target_name_key FROM exercise_illustration_aliases WHERE name_key = $1`, chave).Scan(&alvo)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && alvo == nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("consultar alias: %w", err)
	}
	return *alvo, true, nil
}

// Recusado diz se já perguntamos e nenhuma ilustração era equivalente.
func (a *IlustracaoAliases) Recusado(ctx context.Context, chave string) (bool, error) {
	var recusado bool
	err := a.DB.Pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM exercise_illustration_aliases
		                 WHERE name_key = $1 AND target_name_key IS NULL)`, chave).Scan(&recusado)
	return recusado, err
}

// Resolver tenta reaproveitar uma ilustração existente para o nome. Devolve a
// chave do alvo quando gravou um alias; "" quando é para gerar normalmente
// (recusa, nada a perguntar, ou falha do assistente — esta última NÃO é
// gravada, para que a próxima tentativa possa perguntar de novo).
func (a *IlustracaoAliases) Resolver(ctx context.Context, generator StructuredGenerator, chave, nome string) (string, error) {
	if recusado, err := a.Recusado(ctx, chave); err != nil {
		return "", err
	} else if recusado {
		return "", nil
	}

	rows, err := a.DB.Pool.Query(ctx,
		`SELECT name_key, exercise_name FROM exercise_illustrations
		  WHERE status = 'ready' AND version >= $1 AND name_key <> $2
		  ORDER BY name_key`, a.Versao, chave)
	if err != nil {
		return "", fmt.Errorf("listar ilustrações prontas: %w", err)
	}
	defer rows.Close()
	var candidatas []IlustracaoCandidata
	for rows.Next() {
		var c IlustracaoCandidata
		if err := rows.Scan(&c.Chave, &c.Nome); err != nil {
			return "", err
		}
		candidatas = append(candidatas, c)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}

	alvo, perguntou, err := DecidirEquivalente(ctx, generator, nome, candidatas)
	if err != nil {
		slog.Warn("falha ao decidir equivalência de ilustração; gera normalmente", "exercicio", nome, "erro", err)
		return "", nil
	}
	if !perguntou {
		return "", nil
	}
	if alvo == "" {
		_, err = a.DB.Pool.Exec(ctx,
			`INSERT INTO exercise_illustration_aliases (name_key, target_name_key, decided_by)
			 VALUES ($1, NULL, 'none') ON CONFLICT (name_key) DO NOTHING`, chave)
		return "", err
	}
	// DO UPDATE e não NOTHING: se uma corrida gravou a recusa antes, o vínculo
	// mais recente (já validado) prevalece.
	_, err = a.DB.Pool.Exec(ctx,
		`INSERT INTO exercise_illustration_aliases (name_key, target_name_key, decided_by)
		 VALUES ($1, $2, 'llm')
		 ON CONFLICT (name_key) DO UPDATE
		   SET target_name_key = EXCLUDED.target_name_key, decided_by = 'llm'
		 WHERE exercise_illustration_aliases.target_name_key IS NULL`, chave, alvo)
	if err != nil {
		return "", fmt.Errorf("gravar alias: %w", err)
	}
	// Relê: numa corrida, quem gravou primeiro define o alvo.
	efetivo, _, err := a.Alvo(ctx, chave)
	return efetivo, err
}
