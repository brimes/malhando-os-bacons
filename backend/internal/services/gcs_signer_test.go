package services

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/url"
	"strings"
	"testing"
	"time"
)

// assinadorDeTeste monta um GCSSigner com uma chave RSA gerada na hora. Não
// serve para validar contra o GCS de verdade — isso só um download com 200
// prova —, mas cobre o que erra em silêncio: escape, ordenação e estabilidade
// da URL. Um erro nesses três não quebra compilação nem teste, só devolve 403
// quando o app tentar baixar.
func assinadorDeTeste(t *testing.T) *GCSSigner {
	t.Helper()
	chave, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pkcs8, err := x509.MarshalPKCS8PrivateKey(chave)
	if err != nil {
		t.Fatal(err)
	}
	credencial, err := json.Marshal(map[string]string{
		"client_email": "assinador-videos@projeto.iam.gserviceaccount.com",
		"private_key": string(pem.EncodeToMemory(&pem.Block{
			Type: "PRIVATE KEY", Bytes: pkcs8,
		})),
	})
	if err != nil {
		t.Fatal(err)
	}
	assinador, err := NewGCSSigner("malhando-os-bacons-exercicios", string(credencial), 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return assinador
}

// O nome do objeto tem acento e espaço. Sem escapar, a URL nem é válida;
// escapando a barra, o caminho deixa de apontar para o objeto.
func TestAssinarEscapaNomeComAcentoEEspaco(t *testing.T) {
	assinador := assinadorDeTeste(t)
	bruta, err := assinador.Assinar("exercicios/Bíceps/Rosca martelo.webm", time.Now())
	if err != nil {
		t.Fatal(err)
	}

	if strings.Contains(bruta, " ") {
		t.Error("espaço não escapado na URL")
	}
	if strings.Contains(bruta, "+") {
		t.Error("espaço virou '+': isso é encoding de formulário, o GCS recusa")
	}
	if !strings.Contains(bruta, "/exercicios/B%C3%ADceps/Rosca%20martelo.webm") {
		t.Errorf("caminho escapado fora do esperado: %s", bruta)
	}

	analisada, err := url.Parse(bruta)
	if err != nil {
		t.Fatalf("URL gerada não é válida: %v", err)
	}
	// A barra separadora precisa sobreviver: escapada, o objeto não existe.
	if analisada.EscapedPath() != "/malhando-os-bacons-exercicios/exercicios/B%C3%ADceps/Rosca%20martelo.webm" {
		t.Errorf("caminho inesperado: %s", analisada.EscapedPath())
	}
}

func TestAssinarTemOsParametrosExigidos(t *testing.T) {
	assinador := assinadorDeTeste(t)
	bruta, err := assinador.Assinar("exercicios/Bíceps/Rosca martelo.webm", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	analisada, err := url.Parse(bruta)
	if err != nil {
		t.Fatal(err)
	}
	q := analisada.Query()
	for chave, esperado := range map[string]string{
		"X-Goog-Algorithm":     "GOOG4-RSA-SHA256",
		"X-Goog-SignedHeaders": "host",
	} {
		if q.Get(chave) != esperado {
			t.Errorf("%s = %q, esperado %q", chave, q.Get(chave), esperado)
		}
	}
	if q.Get("X-Goog-Signature") == "" {
		t.Error("sem X-Goog-Signature")
	}
	if !strings.HasPrefix(q.Get("X-Goog-Credential"), "assinador-videos@") {
		t.Errorf("X-Goog-Credential inesperado: %q", q.Get("X-Goog-Credential"))
	}
	if !strings.HasSuffix(q.Get("X-Goog-Credential"), "/auto/storage/goog4_request") {
		t.Errorf("escopo da credencial inesperado: %q", q.Get("X-Goog-Credential"))
	}
}

// A URL precisa ser idêntica byte a byte ao longo do dia: é o que permite ao
// app repetir um download interrompido em vez de recomeçar do zero com outra
// URL, e é o motivo do arredondamento para o início do dia.
func TestAssinarEstavelDentroDoMesmoDia(t *testing.T) {
	assinador := assinadorDeTeste(t)
	manha := time.Date(2026, 8, 7, 0, 0, 1, 0, time.UTC)
	noite := time.Date(2026, 8, 7, 23, 59, 59, 0, time.UTC)

	a, err := assinador.Assinar("exercicios/Bíceps/Rosca martelo.webm", manha)
	if err != nil {
		t.Fatal(err)
	}
	b, err := assinador.Assinar("exercicios/Bíceps/Rosca martelo.webm", noite)
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Error("URLs do mesmo dia diferem — o download reiniciaria a cada tentativa")
	}

	// E precisa mudar de um dia para o outro, senão a validade nunca renova.
	c, err := assinador.Assinar("exercicios/Bíceps/Rosca martelo.webm", noite.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if a == c {
		t.Error("URL não mudou na virada do dia")
	}
}

// A validade tem de cobrir o arredondamento para trás: uma URL emitida às
// 23h59 é assinada com data do começo do dia, então sem a folga ela nasceria
// com poucas horas de vida.
func TestValidadeCobreOArredondamento(t *testing.T) {
	assinador := assinadorDeTeste(t)
	bruta, err := assinador.Assinar("exercicios/Bíceps/Rosca martelo.webm", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	analisada, _ := url.Parse(bruta)
	expira := analisada.Query().Get("X-Goog-Expires")
	// 7 dias + 1 de folga, e nunca acima do teto de 7 dias do protocolo V4.
	if expira != "604800" {
		t.Errorf("X-Goog-Expires = %q, esperado 604800 (teto de 7 dias do V4)", expira)
	}
}

func TestObjetosDiferentesAssinamDiferente(t *testing.T) {
	assinador := assinadorDeTeste(t)
	agora := time.Now()
	a, _ := assinador.Assinar("exercicios/Bíceps/Rosca martelo.webm", agora)
	b, _ := assinador.Assinar("exercicios/Bíceps/Rosca direta.webm", agora)
	if a == b {
		t.Error("objetos diferentes geraram a mesma URL")
	}
}

func TestCredencialInvalidaFalhaNoInicio(t *testing.T) {
	casos := map[string]string{
		"não é JSON":        "isto não é json",
		"sem private_key":   `{"client_email":"a@b.com"}`,
		"private_key vazia": `{"client_email":"a@b.com","private_key":""}`,
		"PEM inválido":      `{"client_email":"a@b.com","private_key":"nada disso é PEM"}`,
	}
	for nome, credencial := range casos {
		if _, err := NewGCSSigner("bucket", credencial, time.Hour); err == nil {
			t.Errorf("%s: devia falhar ao montar o assinador", nome)
		}
	}
}

// Escapar é o ponto onde um deslize não aparece em teste nenhum e vira 403.
func TestEscaparSegueRFC3986(t *testing.T) {
	casos := map[string]string{
		"Rosca martelo":  "Rosca%20martelo",
		"Bíceps":         "B%C3%ADceps",
		"a-b_c.d~e":      "a-b_c.d~e", // não reservados passam intactos
		"Leg Press 45°":  "Leg%20Press%2045%C2%B0",
		"a/b":            "a%2Fb", // a barra só é preservada por codificarCaminho
		"x=1&y=2":        "x%3D1%26y%3D2",
		"Tríceps (test)": "Tr%C3%ADceps%20%28test%29",
	}
	for entrada, esperado := range casos {
		if obtido := escapar(entrada); obtido != esperado {
			t.Errorf("escapar(%q) = %q, esperado %q", entrada, obtido, esperado)
		}
	}
}

// A query canônica é ordenada sobre a forma já escapada. Ordem errada não dá
// erro em lugar nenhum — dá 403.
func TestConsultaCanonicaOrdenada(t *testing.T) {
	obtido := consultaCanonica([][2]string{
		{"X-Goog-SignedHeaders", "host"},
		{"X-Goog-Algorithm", "GOOG4-RSA-SHA256"},
		{"X-Goog-Date", "20260807T000000Z"},
	})
	esperado := "X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Date=20260807T000000Z&X-Goog-SignedHeaders=host"
	if obtido != esperado {
		t.Errorf("consulta canônica = %q, esperado %q", obtido, esperado)
	}
}
