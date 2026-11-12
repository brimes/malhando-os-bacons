package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

// Ilustrações de exercício geradas por IA, para os nomes que o associador
// recusou (sem vídeo no catálogo).
//
// Cache global por nome, como exercise_video_links: gerar uma vez serve todo
// mundo. A tabela é também o "job": a linha 'pending' é a geração em curso, e o
// app faz polling em GET. Assíncrono porque uma geração de imagem leva dezenas
// de segundos e segurar a conexão estouraria o WriteTimeout.
//
// A imagem fica em PhotoDir, não no bucket dos vídeos: a service account do
// bucket é só de leitura (assina URL, não escreve).

const (
	// Teto de gerações iniciadas por usuário por dia. Cada uma é uma chamada de
	// IA paga, e o cache global já evita repetir o mesmo nome.
	limiteIlustracoesPorDia = 10
	// Uma geração 'pending' mais velha que isto é órfã (o processo reiniciou no
	// meio) e pode ser retomada por outro pedido.
	validadePendente = 5 * time.Minute
	tempoMaxGeracao  = 4 * time.Minute
	maxNomeExercicio = 120
	pastaIlustracoes = "exercise-illustrations"
	// Versão atual da ilustração (2 = quadros do movimento). Linhas com
	// version menor são "outdated".
	versaoIlustracao = 2
)

// statusDaLinha traduz a linha do banco no status público: uma pronta de
// versão antiga é "outdated", e uma pendente velha demais é "failed".
func statusDaLinha(status string, version int, updatedAt, agora time.Time) string {
	if status == "ready" && version < versaoIlustracao {
		return "outdated"
	}
	if status == "pending" && agora.Sub(updatedAt) >= validadePendente {
		return "failed"
	}
	return status
}

// cotaEsgotada diz se o usuário já gastou as gerações do dia.
func cotaEsgotada(usadas int) bool { return usadas >= limiteIlustracoesPorDia }

// quadroDaQuery lê &frame=i (padrão 0). Inválido: ok=false.
func quadroDaQuery(r *http.Request) (int, bool) {
	v := r.URL.Query().Get("frame")
	if v == "" {
		return 0, true
	}
	i, err := strconv.Atoi(v)
	if err != nil || i < 0 || i >= services.MaxQuadrosIlustracao {
		return 0, false
	}
	return i, true
}

type ExerciseIllustrationHandler struct {
	db       *db.DB
	resolver services.GeneratorResolver
	photoDir string
	model    string
	// fallback gera imagem com a credencial compartilhada do Gemini quando o
	// provedor do usuário/compartilhado de texto não gera imagem (opencode).
	// nil quando não há GEMINI_API_KEY.
	fallback services.ImageGenerator
	// aliases reaproveita a ilustração de outro nome quando é o mesmo exercício.
	aliases *services.IlustracaoAliases
}

// NewExerciseIllustrationHandler lê GEMINI_IMAGE_MODEL e GEMINI_API_KEY do
// ambiente: o modelo de imagem é independente do de texto.
func NewExerciseIllustrationHandler(database *db.DB, resolver services.GeneratorResolver, photoDir string) *ExerciseIllustrationHandler {
	model := strings.TrimSpace(os.Getenv("GEMINI_IMAGE_MODEL"))
	if model == "" {
		model = services.GeminiDefaultImageModel
	}
	h := &ExerciseIllustrationHandler{db: database, resolver: resolver, photoDir: photoDir, model: model,
		aliases: &services.IlustracaoAliases{DB: database, Versao: versaoIlustracao}}
	if gen, err := services.NewGeminiGenerator(os.Getenv("GEMINI_API_KEY"), ""); err == nil {
		h.fallback = gen
	}
	return h
}

// chaveIlustracao normaliza o nome: minúsculas e espaços colapsados, para
// "Supino  Reto" e "supino reto" dividirem uma imagem só.
func chaveIlustracao(nome string) string {
	return strings.ToLower(strings.Join(strings.Fields(nome), " "))
}

// statusDoVideo traduz a decisão do associador: só a recusa gravada
// ('none') vira "not_found". Sem linha (ainda não associado) devolve vazio.
func statusDoVideo(video *models.ExerciseVideo, resolvedBy *string) string {
	if video == nil && resolvedBy != nil && *resolvedBy == "none" {
		return "not_found"
	}
	return ""
}

// anexarIlustracoes marca os exercícios que já têm ilustração pronta, numa
// consulta só. Falha aqui não derruba a tela: sem a marca o exercício
// simplesmente aparece sem ilustração.
func anexarIlustracoes(ctx context.Context, database *db.DB, exercicios []models.TrainingPlanExercise) {
	if len(exercicios) == 0 {
		return
	}
	chaves := make([]string, 0, len(exercicios))
	for _, e := range exercicios {
		chaves = append(chaves, chaveIlustracao(e.ExerciseName))
	}
	// Um nome com alias usa os quadros do alvo (o alias tem precedência).
	rows, err := database.Pool.Query(ctx,
		`SELECT k.name_key, i.frames, i.version
		   FROM unnest($1::text[]) AS k(name_key)
		   LEFT JOIN exercise_illustration_aliases a
		          ON a.name_key = k.name_key AND a.target_name_key IS NOT NULL
		   JOIN exercise_illustrations i
		     ON i.name_key = COALESCE(a.target_name_key, k.name_key) AND i.status = 'ready'`, chaves)
	if err != nil {
		slog.Warn("falha ao consultar ilustrações", "erro", err)
		return
	}
	defer rows.Close()
	prontas := map[string]models.ExerciseIllustration{}
	for rows.Next() {
		var k string
		var frames, version int
		if rows.Scan(&k, &frames, &version) == nil {
			st := "ready"
			if version < versaoIlustracao {
				st = "outdated"
			}
			prontas[k] = models.ExerciseIllustration{Status: st, Frames: frames}
		}
	}
	for i := range exercicios {
		if il, ok := prontas[chaveIlustracao(exercicios[i].ExerciseName)]; ok {
			exercicios[i].Illustration = &il
		}
	}
}

type respostaIlustracao struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
	Frames int    `json:"frames,omitempty"`
}

func nomeDaQuery(r *http.Request) (string, bool) {
	nome := strings.TrimSpace(r.URL.Query().Get("name"))
	if nome == "" || utf8.RuneCountInString(nome) > maxNomeExercicio {
		return "", false
	}
	return nome, true
}

// exigirSemVideo só deixa passar nomes que o associador recusou: impede usar o
// endpoint como gerador de imagem de texto livre, e evita imagem para quem tem
// vídeo. Escreve a resposta de erro e devolve false quando não passa.
func (h *ExerciseIllustrationHandler) exigirSemVideo(ctx context.Context, w http.ResponseWriter, bruto, nome string) bool {
	// O app manda o nome exatamente como veio do plano; tenta também o aparado.
	for _, candidato := range []string{bruto, nome} {
		var recusado bool
		if err := h.db.Pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM exercise_video_links WHERE exercise_name = $1 AND resolved_by = 'none')`,
			candidato).Scan(&recusado); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
			return false
		}
		if recusado {
			return true
		}
	}
	writeJSON(w, http.StatusConflict, map[string]string{"error": "este exercício não está sem vídeo"})
	return false
}

// Request inicia (ou reaproveita) a geração da ilustração do exercício. Uma
// ilustração desatualizada (imagem única antiga) é regenerada aqui sem gastar
// a cota da pessoa.
func (h *ExerciseIllustrationHandler) Request(w http.ResponseWriter, r *http.Request) {
	h.iniciar(w, r, false)
}

// Regenerate refaz a descrição e os quadros ("não ficou bom"). Consome a cota.
func (h *ExerciseIllustrationHandler) Regenerate(w http.ResponseWriter, r *http.Request) {
	h.iniciar(w, r, true)
}

func (h *ExerciseIllustrationHandler) iniciar(w http.ResponseWriter, r *http.Request, forcar bool) {
	userID, _ := middleware.GetUserID(r.Context())
	var body struct {
		ExerciseName string `json:"exercise_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "corpo inválido"})
		return
	}
	nome := strings.Join(strings.Fields(body.ExerciseName), " ")
	if nome == "" || utf8.RuneCountInString(nome) > maxNomeExercicio {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "exercise_name inválido"})
		return
	}
	chave := chaveIlustracao(nome)
	ctx := r.Context()

	if !h.exigirSemVideo(ctx, w, body.ExerciseName, nome) {
		return
	}

	// Nome que já é alias (ou que vira um agora) usa a ilustração do alvo: daqui
	// em diante `chave` e `nome` são os do alvo. "Não ficou bom" (forcar) num
	// alias regenera o ALVO, de propósito: todos os nomes que o apontam passam a
	// ver a versão nova, e o pedido não cria uma segunda imagem do mesmo exercício.
	if alvo, ok, _ := h.aliases.Alvo(ctx, chave); ok {
		chave = alvo
		nome = h.nomeDaIlustracao(ctx, alvo, nome)
	}

	var status string
	var updatedAt time.Time
	var version, frames int
	existe := true
	consultar := func() error {
		existe = true
		err := h.db.Pool.QueryRow(ctx,
			`SELECT status, updated_at, version, frames FROM exercise_illustrations WHERE name_key = $1`,
			chave).Scan(&status, &updatedAt, &version, &frames)
		if errors.Is(err, pgx.ErrNoRows) {
			existe = false
			return nil
		}
		return err
	}
	if err := consultar(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
		return
	}

	// Antes de pagar uma imagem: o nome sem linha (ou com a linha desatualizada)
	// pode ser outro nome de uma ilustração que já temos. Não consome cota.
	if !forcar && (!existe || (status == "ready" && version < versaoIlustracao)) {
		if alvo, _ := h.aliases.Resolver(ctx, h.resolver.For(ctx, userID), chave, nome); alvo != "" {
			chave = alvo
			nome = h.nomeDaIlustracao(ctx, alvo, nome)
			if err := consultar(); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
				return
			}
		}
	}

	generator, err := h.imageGenerator(ctx, userID)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable,
			map[string]string{"error": "geração de ilustração indisponível no momento"})
		return
	}
	if forcar && !existe {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sem ilustração para este exercício"})
		return
	}
	if existe {
		efetivo := statusDaLinha(status, version, updatedAt, time.Now())
		if efetivo == "pending" || (efetivo == "ready" && !forcar) {
			writeJSON(w, http.StatusOK, respostaIlustracao{Status: efetivo, Frames: frames})
			return
		}
	}
	// Desatualizada: refazer é custo nosso, não da pessoa.
	gratis := !forcar && existe && status == "ready" && version < versaoIlustracao

	if !gratis {
		var usadas int
		if err := h.db.Pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM exercise_illustration_requests
			 WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`, userID).Scan(&usadas); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
			return
		}
		if cotaEsgotada(usadas) {
			writeJSON(w, http.StatusTooManyRequests,
				map[string]string{"error": "limite diário de ilustrações atingido; tente amanhã"})
			return
		}
	}

	// Disputa atômica: o INSERT cria a linha e o UPDATE retoma uma 'failed',
	// uma 'pending' órfã ou uma 'ready' que precisa ser refeita (desatualizada,
	// ou pedido explícito). Quem não ganhar a linha só devolve o estado atual.
	var ganhou bool
	err = h.db.Pool.QueryRow(ctx,
		`WITH claimed AS (
		     INSERT INTO exercise_illustrations (name_key, exercise_name, status, requested_by)
		     VALUES ($1, $2, 'pending', $3)
		     ON CONFLICT (name_key) DO UPDATE
		        SET status = 'pending', error = NULL, requested_by = $3, updated_at = NOW()
		      WHERE exercise_illustrations.status = 'failed'
		         OR (exercise_illustrations.status = 'ready'
		             AND ($6 OR exercise_illustrations.version < $5))
		         OR (exercise_illustrations.status = 'pending'
		             AND exercise_illustrations.updated_at < NOW() - make_interval(secs => $4))
		     RETURNING 1)
		 SELECT EXISTS (SELECT 1 FROM claimed)`,
		chave, nome, userID, validadePendente.Seconds(), versaoIlustracao, forcar).Scan(&ganhou)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao iniciar a geração"})
		return
	}
	if !ganhou {
		writeJSON(w, http.StatusOK, respostaIlustracao{Status: "pending"})
		return
	}
	if !gratis {
		if _, err := h.db.Pool.Exec(ctx,
			`INSERT INTO exercise_illustration_requests (user_id, name_key) VALUES ($1, $2)`, userID, chave); err != nil {
			slog.Warn("falha ao registrar pedido de ilustração", "erro", err)
		}
	}

	go h.gerar(chave, nome, h.resolver.For(ctx, userID), generator)
	writeJSON(w, http.StatusAccepted, respostaIlustracao{Status: "pending"})
}

// nomeDaIlustracao devolve o exercise_name da linha do alvo (o nome que foi
// usado no prompt da imagem); alternativo se não achar.
func (h *ExerciseIllustrationHandler) nomeDaIlustracao(ctx context.Context, chave, alternativo string) string {
	var nome string
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT exercise_name FROM exercise_illustrations WHERE name_key = $1`, chave).Scan(&nome); err != nil {
		return alternativo
	}
	return nome
}

// chaveEfetiva é a chave cujos quadros o nome usa: a do alvo se houver alias.
func (h *ExerciseIllustrationHandler) chaveEfetiva(ctx context.Context, nome string) string {
	chave := chaveIlustracao(nome)
	if alvo, ok, _ := h.aliases.Alvo(ctx, chave); ok {
		return alvo
	}
	return chave
}

// imageGenerator escolhe a credencial: a do usuário (Gemini próprio) ou a
// compartilhada, se geram imagem; senão cai para a chave compartilhada do
// Gemini; senão indisponível.
func (h *ExerciseIllustrationHandler) imageGenerator(ctx context.Context, userID int64) (services.ImageGenerator, error) {
	if g, ok := h.resolver.For(ctx, userID).(services.ImageGenerator); ok {
		return g, nil
	}
	if h.fallback != nil {
		return h.fallback, nil
	}
	return nil, services.ErrImageNotSupported
}

// gerar roda em segundo plano: 1) descrição em texto do aparelho e do
// movimento; 2) uma imagem com todos os quadros em fileira; 3) recorte em
// quadros iguais, gravados como JPEG.
func (h *ExerciseIllustrationHandler) gerar(chave, nome string, texto services.StructuredGenerator, imagem services.ImageGenerator) {
	ctx, cancel := context.WithTimeout(context.Background(), tempoMaxGeracao)
	defer cancel()

	falhar := func(msg string, err error) {
		slog.Error("falha ao gerar ilustração", "exercicio", nome, "erro", err)
		if _, e := h.db.Pool.Exec(context.Background(),
			`UPDATE exercise_illustrations SET status='failed', error=$2, updated_at=NOW() WHERE name_key=$1`,
			chave, msg); e != nil {
			slog.Error("falha ao gravar o estado da ilustração", "erro", e)
		}
	}

	var desc services.DescricaoMovimento
	if err := texto.Generate(ctx, services.PromptDescricaoMovimento, "Exercise: "+nome,
		services.EsquemaDescricaoMovimento(), &desc); err != nil {
		falhar("não foi possível descrever o movimento; tente novamente", err)
		return
	}
	if err := desc.Normalizar(); err != nil {
		falhar("não foi possível descrever o movimento; tente novamente", err)
		return
	}

	data, _, err := imagem.GenerateImage(ctx, h.model, services.PromptTiraDeQuadros(nome, desc),
		services.ProporcaoTira(desc.Frames))
	if err != nil {
		falhar("não foi possível gerar a ilustração; tente novamente", err)
		return
	}
	quadros, err := services.RecortarQuadros(data, desc.Frames)
	if err != nil {
		falhar("a imagem gerada não pôde ser dividida em quadros; tente novamente", err)
		return
	}

	rel, err := h.gravarQuadros(quadros)
	if err != nil {
		falhar("não foi possível salvar a ilustração; tente novamente", err)
		return
	}
	descJSON, _ := json.MarshalIndent(desc, "", "  ")

	var anterior *string
	_ = h.db.Pool.QueryRow(context.Background(),
		`SELECT storage_path FROM exercise_illustrations WHERE name_key=$1`, chave).Scan(&anterior)
	if _, err := h.db.Pool.Exec(context.Background(),
		`UPDATE exercise_illustrations
		    SET status='ready', storage_path=$2, content_type='image/jpeg', error=NULL,
		        frames=$3, description=$4, version=$5, updated_at=NOW()
		  WHERE name_key=$1`, chave, rel, len(quadros), string(descJSON), versaoIlustracao); err != nil {
		slog.Error("falha ao marcar ilustração como pronta", "erro", err)
		_ = os.RemoveAll(filepath.Join(h.photoDir, rel))
		return
	}
	// Troca concluída: a imagem (ou pasta) anterior não é mais referenciada.
	if anterior != nil && *anterior != rel && strings.HasPrefix(*anterior, pastaIlustracoes+"/") {
		_ = os.RemoveAll(filepath.Join(h.photoDir, *anterior))
	}
}

// gravarQuadros grava os quadros em PhotoDir/exercise-illustrations/<id>/<i>.jpg
// e devolve o caminho relativo da pasta.
func (h *ExerciseIllustrationHandler) gravarQuadros(quadros [][]byte) (string, error) {
	id, err := randomFilename()
	if err != nil {
		return "", err
	}
	rel := filepath.Join(pastaIlustracoes, id)
	dir := filepath.Join(h.photoDir, rel)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	for i, q := range quadros {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.jpg", i)), q, 0o644); err != nil {
			_ = os.RemoveAll(dir)
			return "", err
		}
	}
	return rel, nil
}

// Status devolve o estado da geração para o nome (polling).
func (h *ExerciseIllustrationHandler) Status(w http.ResponseWriter, r *http.Request) {
	nome, ok := nomeDaQuery(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name inválido"})
		return
	}
	var status string
	var msg *string
	var updatedAt time.Time
	var version, frames int
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT status, error, updated_at, version, frames FROM exercise_illustrations WHERE name_key = $1`,
		h.chaveEfetiva(r.Context(), nome)).Scan(&status, &msg, &updatedAt, &version, &frames)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sem ilustração para este exercício"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
		return
	}
	efetivo := statusDaLinha(status, version, updatedAt, time.Now())
	resp := respostaIlustracao{Status: efetivo, Frames: frames}
	if efetivo == "failed" && status == "pending" {
		// Órfã de um reinício: o app não deve ficar girando para sempre.
		resp.Error = "a geração foi interrompida; tente novamente"
	} else if msg != nil {
		resp.Error = *msg
	}
	writeJSON(w, http.StatusOK, resp)
}

// Image serve um quadro (&frame=i, padrão 0). Autenticada, e o caminho em
// disco vem sempre do banco, nunca do cliente.
func (h *ExerciseIllustrationHandler) Image(w http.ResponseWriter, r *http.Request) {
	nome, ok := nomeDaQuery(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name inválido"})
		return
	}
	quadro, ok := quadroDaQuery(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "frame inválido"})
		return
	}
	var path, mime string
	var updatedAt time.Time
	var frames, version int
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT storage_path, content_type, updated_at, frames, version FROM exercise_illustrations
		 WHERE name_key = $1 AND status = 'ready'`, h.chaveEfetiva(r.Context(), nome)).Scan(&path, &mime, &updatedAt, &frames, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ilustração não encontrada"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
		return
	}
	if quadro >= frames {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "frame inválido"})
		return
	}
	arquivo := filepath.Join(h.photoDir, path)
	if version >= versaoIlustracao {
		arquivo = filepath.Join(arquivo, fmt.Sprintf("%d.jpg", quadro))
	}
	file, err := os.Open(arquivo)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "arquivo não encontrado"})
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", mime)
	// A URL é a mesma depois de regenerar: revalida em vez de servir o quadro velho.
	w.Header().Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, "", updatedAt, file)
}
