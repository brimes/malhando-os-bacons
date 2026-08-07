package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

// Endpoints dos vídeos demonstrativos de exercício.
//
// O bucket é privado (public access prevention ligado): sem URL assinada, o
// acesso direto devolve 403. O app pede a assinatura aqui, baixa os arquivos e
// nunca mais volta à rede para tocá-los — assina uma vez, no download, jamais
// na reprodução.
type ExerciseVideoHandler struct {
	db        *db.DB
	assinador *services.GCSSigner
}

func NewExerciseVideoHandler(database *db.DB, assinador *services.GCSSigner) *ExerciseVideoHandler {
	return &ExerciseVideoHandler{db: database, assinador: assinador}
}

// Quantos objetos podem ser assinados numa requisição. O app baixa o acervo
// inteiro (963 vídeos), então o lote é o que evita 963 requisições — mas
// assinar é RSA e custa CPU, e um teto alto demais deixaria um cliente
// segurar um worker por segundos.
const maxObjetosPorLote = 200

type pedidoAssinatura struct {
	Objetos []string `json:"objetos"`
}

type respostaAssinatura struct {
	URLs map[string]string `json:"urls"`
}

// SignURLs assina em lote os objetos pedidos.
//
// Exige autenticação — diferente do assinador em Cloud Run, que era aberto.
// Não é por sigilo do conteúdo (são vídeos de demonstração de exercício), mas
// porque quem paga o egress do bucket é o dono do projeto, e um endpoint
// aberto que devolve URL assinada é um proxy de download para qualquer um.
func (h *ExerciseVideoHandler) SignURLs(w http.ResponseWriter, r *http.Request) {
	if h.assinador == nil {
		// Sem credencial configurada. 503 e não 500: é configuração ausente,
		// e o app trata como "tente de novo mais tarde" em vez de desistir.
		writeJSON(w, http.StatusServiceUnavailable,
			map[string]string{"error": "assinatura de vídeos não configurada"})
		return
	}

	var pedido pedidoAssinatura
	if err := json.NewDecoder(r.Body).Decode(&pedido); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "corpo inválido"})
		return
	}
	if len(pedido.Objetos) == 0 || len(pedido.Objetos) > maxObjetosPorLote {
		writeJSON(w, http.StatusBadRequest,
			map[string]string{"error": "objetos deve ter entre 1 e 200 itens"})
		return
	}

	agora := time.Now()
	urls := make(map[string]string, len(pedido.Objetos))
	for _, objeto := range pedido.Objetos {
		// O prefixo é a fronteira: sem ele, este endpoint assina qualquer
		// objeto que a service account alcance. Ela só tem leitura neste
		// bucket, mas defender aqui não custa nada e não depende do IAM
		// continuar como está.
		if !strings.HasPrefix(objeto, "exercicios/") {
			writeJSON(w, http.StatusBadRequest,
				map[string]string{"error": "objeto fora do prefixo permitido"})
			return
		}
		url, err := h.assinador.Assinar(objeto, agora)
		if err != nil {
			slog.Error("falha ao assinar objeto", "objeto", objeto, "erro", err)
			writeJSON(w, http.StatusInternalServerError,
				map[string]string{"error": "falha ao assinar"})
			return
		}
		urls[objeto] = url
	}
	writeJSON(w, http.StatusOK, respostaAssinatura{URLs: urls})
}

// montarVideo converte as três colunas anuláveis do LEFT JOIN com
// exercise_video_links num apontamento, ou nil quando não há vídeo.
//
// Exige os três campos: a tabela tem CHECK garantindo que venham juntos, mas
// um vínculo pela metade que escapasse faria o app pedir a assinatura de uma
// string vazia e receber 400 em cima de um download que nunca ia funcionar.
func montarVideo(catalogo, webm, mp4 *string) *models.ExerciseVideo {
	if catalogo == nil || webm == nil || mp4 == nil {
		return nil
	}
	return &models.ExerciseVideo{CatalogName: *catalogo, WebM: *webm, MP4: *mp4}
}

// Catalog devolve o acervo inteiro: nome, objeto webm e objeto mp4.
//
// O app usa isto para baixar tudo de uma vez no primeiro Wi-Fi. Baixar o
// acervo completo (963 vídeos, ~95 MB) em vez de só os do treino salvo elimina
// a lógica de ciclo de vida — o que baixar, o que apagar, o que fazer quando a
// pessoa abre um exercício que ainda não veio — e, principalmente, faz com que
// melhorar um vínculo depois não custe download nenhum: o arquivo já está no
// aparelho, só o apontamento muda.
func (h *ExerciseVideoHandler) Catalog(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"exercicios": services.CatalogoCompleto(),
	})
}
