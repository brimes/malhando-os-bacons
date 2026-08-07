package services

import (
	"strings"
	"testing"
	"unicode"
)

// A dobra de acento é escrita à mão, então o risco é uma letra acentuada que
// ninguém previu passar batido e virar caractere descartado no meio de uma
// palavra — "Abdução" viraria "abdu o" e nunca casaria com nada. Em vez de
// confiar na lista, verifica contra o catálogo inteiro.
func TestDobraCobreCatalogo(t *testing.T) {
	for _, e := range CatalogoCompleto() {
		for _, r := range strings.ToLower(e.Nome) {
			if r > unicode.MaxASCII && !unicode.IsSpace(r) {
				if _, ok := acentos[r]; !ok {
					t.Errorf("letra %q (em %q) não está no mapa de acentos", r, e.Nome)
				}
			}
		}
	}
}

func TestCatalogoCarregaCompleto(t *testing.T) {
	catalogo := CatalogoCompleto()
	if len(catalogo) != 963 {
		t.Fatalf("esperado 963 exercícios, veio %d", len(catalogo))
	}
	for _, e := range catalogo {
		// O caminho do objeto termina com o nome exato. Se isso deixar de
		// valer, o vínculo aponta para um arquivo que não é o do exercício.
		if !strings.HasSuffix(e.WebM, "/"+e.Nome+".webm") {
			t.Errorf("webm não corresponde ao nome: %q / %q", e.Nome, e.WebM)
		}
		if !strings.HasSuffix(e.MP4, "/"+e.Nome+".mp4") {
			t.Errorf("mp4 não corresponde ao nome: %q / %q", e.Nome, e.MP4)
		}
		if !strings.HasPrefix(e.WebM, "exercicios/") || !strings.HasPrefix(e.MP4, "exercicios/") {
			t.Errorf("objeto fora do prefixo permitido: %q", e.Nome)
		}
	}
}

// O nome é a chave em todo o sistema: precisa sair daqui byte a byte como
// entrou. Este teste existe para quebrar se alguém introduzir normalização no
// caminho de leitura — que é o erro que arruinaria o vínculo em silêncio.
func TestNomeNaoENormalizado(t *testing.T) {
	e, ok := CatalogoPorNome("Abdução de Quadril Lateral")
	if !ok {
		t.Fatal("nome com acento não encontrado — houve normalização no caminho")
	}
	if e.Nome != "Abdução de Quadril Lateral" {
		t.Errorf("nome devolvido alterado: %q", e.Nome)
	}
}

// O estágio 1 só precisa acertar uma coisa: pôr a resposta certa na lista.
// Quem escolhe entre elas é o LLM, que enxerga a palavra que distingue. Os
// casos abaixo saíram dos nomes reais gravados no banco do dono do projeto —
// nenhum deles casa exatamente com o catálogo.
func TestCandidatosContemARespostaCerta(t *testing.T) {
	casos := []struct {
		consulta string
		esperado string
	}{
		// O caso que derrubou a primeira tentativa: uma versão anterior tratava
		// "reto" como palavra vazia e casava com o supino DECLINADO.
		{"Supino Reto com Barra", "Supino Reto"},
		{"Agachamento Livre com Barra", "Agachamento Barra"},
		{"Leg Press 45°", "Leg Press"},
		{"Puxada Alta pela Frente", "Puxada Alta"},
		{"Aquecimento no Elíptico", "Máquina Elíptica"},
		{"Aquecimento no Remo Ergômetro", "Máquina de remo"},
		{"Aquecimento na Esteira com Inclinação", "Esteira com Inclinação"},
		{"Crucifixo Invertido no Pec Deck", "Voador invertido"},
		{"Desenvolvimento com Halteres Sentado", "Desenvolvimento de Ombro no Banco com Halteres"},
		{"Tríceps Pulley com Corda", "Tríceps pulley corda"},
		{"Cadeira Extensora", "Cadeira extensora"},
		{"Mesa Flexora", "Mesa flexora"},
		{"Stiff com Barra", "Stiff com barra"},
		{"Rosca Direta com Barra EZ", "Rosca direta com barra w"},
		{"Gêmeos em Pé no Máquina", "Elevação de Panturrilha em Máquina em pé"},
	}
	for _, caso := range casos {
		candidatos := CandidatosCatalogo(caso.consulta, 10)
		achou := false
		for _, c := range candidatos {
			if c.Nome == caso.esperado {
				achou = true
				break
			}
		}
		if !achou {
			nomes := make([]string, 0, len(candidatos))
			for _, c := range candidatos {
				nomes = append(nomes, c.Nome)
			}
			t.Errorf("%q: %q ficou fora dos candidatos.\n  vieram: %s",
				caso.consulta, caso.esperado, strings.Join(nomes, " | "))
		}
	}
}

func TestCandidatosLimitaQuantidade(t *testing.T) {
	if n := len(CandidatosCatalogo("Supino", 5)); n > 5 {
		t.Errorf("pedidos 5 candidatos, vieram %d", n)
	}
}

// Consulta que não é exercício nenhum não pode devolver um palpite qualquer com
// aparência de acerto — mas devolver alguns candidatos fracos é aceitável,
// porque o LLM ainda vai recusar. O que não pode é estourar.
func TestCandidatosComConsultaVaziaNaoQuebra(t *testing.T) {
	if c := CandidatosCatalogo("", 10); c != nil {
		t.Errorf("consulta vazia devia devolver nada, veio %d", len(c))
	}
	if c := CandidatosCatalogo("   de com o   ", 10); c != nil {
		t.Errorf("consulta só com palavras vazias devia devolver nada, veio %d", len(c))
	}
}
