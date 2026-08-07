package services

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Assinatura V4 de URL do Cloud Storage, escrita sobre a stdlib.
//
// Por que não `cloud.google.com/go/storage`: assinar é RSA-SHA256 sobre uma
// string montada segundo uma regra pública, e nada aqui fala com a rede. O
// pacote da Google traria uma árvore de dependências grande para um módulo que
// hoje tem três dependências diretas.
//
// O bucket dos vídeos é privado, com public access prevention: sem URL
// assinada, o acesso direto devolve 403.

const (
	gcsHost         = "storage.googleapis.com"
	gcsAlgoritmo    = "GOOG4-RSA-SHA256"
	gcsEscopo       = "auto/storage/goog4_request"
	gcsValidadeMax  = 7 * 24 * time.Hour
	gcsCargaSemHash = "UNSIGNED-PAYLOAD"
)

// GCSSigner assina URLs de leitura para objetos de um bucket.
type GCSSigner struct {
	bucket     string
	contaEmail string
	chave      *rsa.PrivateKey
	validade   time.Duration
}

// credencialConta é o recorte que interessa do JSON de service account.
type credencialConta struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
}

// NewGCSSigner monta o assinador a partir do JSON de uma service account.
//
// credencialJSON vem do secret do k8s. A chave privada nunca sai daqui: não
// entra em log, não volta em JSON, e o app só recebe a URL já assinada.
func NewGCSSigner(bucket, credencialJSON string, validade time.Duration) (*GCSSigner, error) {
	var cred credencialConta
	if err := json.Unmarshal([]byte(credencialJSON), &cred); err != nil {
		return nil, fmt.Errorf("credencial da service account não é JSON válido: %w", err)
	}
	if cred.ClientEmail == "" || cred.PrivateKey == "" {
		return nil, fmt.Errorf("credencial da service account sem client_email ou private_key")
	}
	if validade <= 0 || validade > gcsValidadeMax {
		validade = gcsValidadeMax
	}

	bloco, _ := pem.Decode([]byte(cred.PrivateKey))
	if bloco == nil {
		return nil, fmt.Errorf("private_key da service account não está em PEM")
	}
	analisada, err := x509.ParsePKCS8PrivateKey(bloco.Bytes)
	if err != nil {
		return nil, fmt.Errorf("private_key da service account inválida: %w", err)
	}
	chave, ok := analisada.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("private_key da service account não é RSA")
	}

	return &GCSSigner{bucket: bucket, contaEmail: cred.ClientEmail, chave: chave, validade: validade}, nil
}

// Assinar devolve uma URL de leitura temporária para o objeto.
//
// O instante da assinatura é arredondado para o início do dia UTC, de modo que
// todas as URLs emitidas para o mesmo objeto no mesmo dia sejam idênticas byte
// a byte. Sem isso, cada pedido devolveria uma URL diferente para o mesmo
// arquivo: uma retentativa de download vira um download novo, e nada do que o
// app guardou sobre downloads em andamento continua valendo.
func (s *GCSSigner) Assinar(objeto string, agora time.Time) (string, error) {
	if objeto == "" {
		return "", fmt.Errorf("objeto vazio")
	}
	emissao := agora.UTC().Truncate(24 * time.Hour)
	carimbo := emissao.Format("20060102T150405Z")
	dia := emissao.Format("20060102")
	escopo := dia + "/" + gcsEscopo

	// A validade precisa cobrir o arredondamento para trás, senão uma URL
	// emitida no fim do dia já nasceria perto de expirar.
	segundos := int((s.validade + 24*time.Hour).Seconds())
	if maxSegundos := int(gcsValidadeMax.Seconds()); segundos > maxSegundos {
		segundos = maxSegundos
	}

	parametros := [][2]string{
		{"X-Goog-Algorithm", gcsAlgoritmo},
		{"X-Goog-Credential", s.contaEmail + "/" + escopo},
		{"X-Goog-Date", carimbo},
		{"X-Goog-Expires", fmt.Sprintf("%d", segundos)},
		{"X-Goog-SignedHeaders", "host"},
	}
	consulta := consultaCanonica(parametros)

	caminho := "/" + s.bucket + "/" + codificarCaminho(objeto)
	requisicaoCanonica := strings.Join([]string{
		"GET",
		caminho,
		consulta,
		"host:" + gcsHost + "\n",
		"host",
		gcsCargaSemHash,
	}, "\n")

	resumo := sha256.Sum256([]byte(requisicaoCanonica))
	aAssinar := strings.Join([]string{
		gcsAlgoritmo,
		carimbo,
		escopo,
		hex.EncodeToString(resumo[:]),
	}, "\n")

	resumoAssinatura := sha256.Sum256([]byte(aAssinar))
	assinatura, err := rsa.SignPKCS1v15(rand.Reader, s.chave, crypto.SHA256, resumoAssinatura[:])
	if err != nil {
		return "", fmt.Errorf("assinar: %w", err)
	}

	return fmt.Sprintf("https://%s%s?%s&X-Goog-Signature=%s",
		gcsHost, caminho, consulta, hex.EncodeToString(assinatura)), nil
}

// consultaCanonica monta a query ordenada por nome, com nome e valor
// escapados. A ordenação é sobre a forma JÁ escapada — é o que a especificação
// pede, e trocar a ordem invalida a assinatura.
func consultaCanonica(parametros [][2]string) string {
	partes := make([]string, 0, len(parametros))
	for _, p := range parametros {
		partes = append(partes, escapar(p[0])+"="+escapar(p[1]))
	}
	sort.Strings(partes)
	return strings.Join(partes, "&")
}

// codificarCaminho escapa cada segmento preservando as barras. Os nomes de
// objeto têm acento e espaço ("exercicios/Bíceps/Rosca martelo.webm"), então
// isto não é detalhe: sem escapar, a URL nem é válida; escapando a barra, o
// caminho deixa de apontar para o objeto.
func codificarCaminho(objeto string) string {
	segmentos := strings.Split(objeto, "/")
	for i, s := range segmentos {
		segmentos[i] = escapar(s)
	}
	return strings.Join(segmentos, "/")
}

// escapar aplica percent-encoding de RFC 3986 sobre os bytes UTF-8.
//
// Escrito à mão porque `url.QueryEscape` codifica espaço como "+" e
// `url.PathEscape` deixa passar caracteres que a assinatura do GCS espera
// escapados (":" e "=", entre outros). Qualquer divergência aqui não dá erro
// de compilação nem de execução — dá 403 na hora de baixar.
func escapar(s string) string {
	const naoReservados = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if strings.IndexByte(naoReservados, c) >= 0 {
			b.WriteByte(c)
			continue
		}
		fmt.Fprintf(&b, "%%%02X", c)
	}
	return b.String()
}
