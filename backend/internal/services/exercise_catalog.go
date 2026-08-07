package services

import (
	_ "embed"
	"encoding/json"
	"math"
	"sort"
	"strings"
	"sync"
	"unicode"
)

// O catálogo dos vídeos de exercício, embutido no binário.
//
// Por que embutido e não lido do bucket: o backend precisa dele em toda
// geração de plano, e ir à rede transformaria uma falha do GCS em falha de
// geração de plano. São 167 KB e mudam junto com o próprio conteúdo do bucket,
// que é raro.
//
// O arquivo é derivado de `catalog-bucket.json` (a fonte da verdade, que vive
// no bucket) por `scripts/gerar-catalogo-exercicios.js`, que só descarta os
// campos que o backend não usa. Os nomes vêm de lá byte a byte.
//
//go:embed exercise_catalog.json
var catalogoBruto []byte

// ExercicioCatalogo é uma entrada do catálogo.
//
// Nome é a chave de identificação do exercício no bucket e nos caminhos dos
// objetos: em NFC, com acento, espaço e caixa originais. Nunca normalize o que
// for gravado ou devolvido a partir daqui — a normalização existe só dentro do
// casamento, sobre cópias descartáveis.
type ExercicioCatalogo struct {
	Nome string `json:"nome"`
	WebM string `json:"webm"`
	MP4  string `json:"mp4"`
}

type alvoCatalogo struct {
	ExercicioCatalogo
	tokens    map[string]struct{}
	trigramas map[string]struct{}
}

var (
	catalogoUmaVez  sync.Once
	catalogoAlvos   []alvoCatalogo
	catalogoPorNome map[string]ExercicioCatalogo
	idfPorToken     map[string]float64
)

// Palavras que ligam mas não distinguem. A lista é curta de propósito: tudo
// que sai daqui é uma palavra que o casamento deixa de enxergar, e foi
// exatamente assim que uma versão anterior confundiu "Supino Reto" com
// "Supino declinado" — ela tratava "reto" como irrelevante.
var palavrasVazias = map[string]struct{}{
	"com": {}, "de": {}, "da": {}, "do": {}, "na": {}, "no": {}, "em": {},
	"a": {}, "o": {}, "os": {}, "as": {}, "e": {}, "para": {}, "pela": {}, "pelo": {},
}

func carregarCatalogo() {
	catalogoUmaVez.Do(func() {
		var entradas []ExercicioCatalogo
		if err := json.Unmarshal(catalogoBruto, &entradas); err != nil {
			// Impossível em produção: o arquivo é embutido e validado no build.
			panic("catálogo de exercícios inválido: " + err.Error())
		}
		catalogoPorNome = make(map[string]ExercicioCatalogo, len(entradas))
		catalogoAlvos = make([]alvoCatalogo, 0, len(entradas))
		frequencia := make(map[string]int)
		for _, e := range entradas {
			catalogoPorNome[e.Nome] = e
			tokens := conjuntoTokens(e.Nome)
			catalogoAlvos = append(catalogoAlvos, alvoCatalogo{
				ExercicioCatalogo: e,
				tokens:            tokens,
				trigramas:         trigramas(e.Nome),
			})
			for t := range tokens {
				frequencia[t]++
			}
		}
		// IDF: "com halteres" aparece em centenas de nomes e quase não informa;
		// "pec deck" aparece em três e é praticamente uma chave.
		total := float64(len(entradas))
		idfPorToken = make(map[string]float64, len(frequencia))
		for t, n := range frequencia {
			idfPorToken[t] = math.Log(total / float64(1+n))
		}
	})
}

// CatalogoPorNome devolve a entrada exata, se existir. Usado para revalidar a
// escolha do LLM: se ele inventar um nome, não encontramos e descartamos.
func CatalogoPorNome(nome string) (ExercicioCatalogo, bool) {
	carregarCatalogo()
	e, ok := catalogoPorNome[nome]
	return e, ok
}

// CatalogoCompleto devolve todas as entradas, para o app baixar o acervo.
func CatalogoCompleto() []ExercicioCatalogo {
	carregarCatalogo()
	saida := make([]ExercicioCatalogo, 0, len(catalogoAlvos))
	for _, a := range catalogoAlvos {
		saida = append(saida, a.ExercicioCatalogo)
	}
	return saida
}

// Dobra de acento feita à mão em vez de NFD + remoção de marcas via
// `golang.org/x/text`, que hoje só é dependência indireta do módulo: o ganho
// não paga promovê-la a direta. O conjunto é fechado — o catálogo é português
// e espanhol — e `TestDobraCobreCatalogo` verifica contra os 963 nomes que
// nenhuma letra acentuada escapou.
var acentos = map[rune]rune{
	'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a',
	'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
	'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
	'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
	'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
	'ç': 'c', 'ñ': 'n', 'ý': 'y', 'ÿ': 'y',
}

// normalizar devolve uma forma comparável — sem acento, sem caixa, sem
// pontuação. Só para comparar: o valor original nunca é substituído por este.
func normalizar(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	anteriorEspaco := true
	for _, r := range strings.ToLower(s) {
		if dobrado, ok := acentos[r]; ok {
			r = dobrado
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			anteriorEspaco = false
			continue
		}
		if !anteriorEspaco {
			b.WriteRune(' ')
			anteriorEspaco = true
		}
	}
	return strings.TrimSpace(b.String())
}

func conjuntoTokens(s string) map[string]struct{} {
	saida := make(map[string]struct{})
	for _, palavra := range strings.Fields(normalizar(s)) {
		if _, vazia := palavrasVazias[palavra]; vazia {
			continue
		}
		saida[palavra] = struct{}{}
	}
	return saida
}

// trigramas pega o nome sem espaços para que "pec deck" e "pecdeck" casem, e
// para tolerar plural e pequena variação de grafia que o token inteiro perde.
func trigramas(s string) map[string]struct{} {
	texto := " " + strings.ReplaceAll(normalizar(s), " ", "") + " "
	runas := []rune(texto)
	saida := make(map[string]struct{})
	for i := 0; i+3 <= len(runas); i++ {
		saida[string(runas[i:i+3])] = struct{}{}
	}
	return saida
}

func jaccard(a, b map[string]struct{}) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	intersecao := 0
	for x := range a {
		if _, ok := b[x]; ok {
			intersecao++
		}
	}
	uniao := len(a) + len(b) - intersecao
	if uniao == 0 {
		return 0
	}
	return float64(intersecao) / float64(uniao)
}

// CandidatosCatalogo devolve os n nomes do catálogo mais parecidos com a
// consulta, do melhor para o pior.
//
// Este é o estágio 1 do associador, e o critério aqui é ABRANGÊNCIA, não
// acerto: basta que o nome certo esteja na lista, porque quem escolhe é o LLM
// no estágio 2, que enxerga a palavra que distingue. Peneirar demais aqui
// elimina a resposta certa antes que alguém possa reconhecê-la.
func CandidatosCatalogo(consulta string, n int) []ExercicioCatalogo {
	carregarCatalogo()
	tokens := conjuntoTokens(consulta)
	if len(tokens) == 0 {
		return nil
	}
	gramas := trigramas(consulta)

	pesoConsulta := 0.0
	for t := range tokens {
		pesoConsulta += idfPorToken[t]
	}
	if pesoConsulta <= 0 {
		// Todos os tokens são inéditos no catálogo: cai só nos trigramas.
		pesoConsulta = 1
	}

	type pontuado struct {
		alvo  ExercicioCatalogo
		ponto float64
	}
	pontos := make([]pontuado, 0, len(catalogoAlvos))
	for _, a := range catalogoAlvos {
		peso := 0.0
		for t := range tokens {
			if _, ok := a.tokens[t]; ok {
				peso += idfPorToken[t]
			}
		}
		ponto := (peso/pesoConsulta)*0.6 + jaccard(gramas, a.trigramas)*0.4
		if ponto <= 0 {
			continue
		}
		pontos = append(pontos, pontuado{alvo: a.ExercicioCatalogo, ponto: ponto})
	}
	sort.SliceStable(pontos, func(i, j int) bool { return pontos[i].ponto > pontos[j].ponto })
	if len(pontos) > n {
		pontos = pontos[:n]
	}
	saida := make([]ExercicioCatalogo, 0, len(pontos))
	for _, p := range pontos {
		saida = append(saida, p.alvo)
	}
	return saida
}
