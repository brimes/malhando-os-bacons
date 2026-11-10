package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	_ "image/png"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
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
	tempoMaxGeracao  = 3 * time.Minute
	maxNomeExercicio = 120
	pastaIlustracoes = "exercise-illustrations"
)

type ExerciseIllustrationHandler struct {
	db       *db.DB
	resolver services.GeneratorResolver
	photoDir string
	model    string
	// fallback gera imagem com a credencial compartilhada do Gemini quando o
	// provedor do usuário/compartilhado de texto não gera imagem (opencode).
	// nil quando não há GEMINI_API_KEY.
	fallback services.ImageGenerator
}

// NewExerciseIllustrationHandler lê GEMINI_IMAGE_MODEL e GEMINI_API_KEY do
// ambiente: o modelo de imagem é independente do de texto.
func NewExerciseIllustrationHandler(database *db.DB, resolver services.GeneratorResolver, photoDir string) *ExerciseIllustrationHandler {
	model := strings.TrimSpace(os.Getenv("GEMINI_IMAGE_MODEL"))
	if model == "" {
		model = services.GeminiDefaultImageModel
	}
	h := &ExerciseIllustrationHandler{db: database, resolver: resolver, photoDir: photoDir, model: model}
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
	rows, err := database.Pool.Query(ctx,
		`SELECT name_key FROM exercise_illustrations WHERE status = 'ready' AND name_key = ANY($1)`, chaves)
	if err != nil {
		slog.Warn("falha ao consultar ilustrações", "erro", err)
		return
	}
	defer rows.Close()
	prontas := map[string]bool{}
	for rows.Next() {
		var k string
		if rows.Scan(&k) == nil {
			prontas[k] = true
		}
	}
	for i := range exercicios {
		if prontas[chaveIlustracao(exercicios[i].ExerciseName)] {
			exercicios[i].Illustration = &models.ExerciseIllustration{Status: "ready"}
		}
	}
}

type respostaIlustracao struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

func nomeDaQuery(r *http.Request) (string, bool) {
	nome := strings.TrimSpace(r.URL.Query().Get("name"))
	if nome == "" || utf8.RuneCountInString(nome) > maxNomeExercicio {
		return "", false
	}
	return nome, true
}

// Request inicia (ou reaproveita) a geração da ilustração do exercício.
func (h *ExerciseIllustrationHandler) Request(w http.ResponseWriter, r *http.Request) {
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

	// Só nomes que o associador recusou: impede usar o endpoint como gerador
	// de imagem de texto livre, e evita imagem para quem tem vídeo.
	var recusado bool
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM exercise_video_links WHERE exercise_name = $1 AND resolved_by = 'none')`,
		body.ExerciseName).Scan(&recusado); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
		return
	}
	if !recusado {
		// O app manda o nome exatamente como veio do plano; tenta também o aparado.
		if err := h.db.Pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM exercise_video_links WHERE exercise_name = $1 AND resolved_by = 'none')`,
			nome).Scan(&recusado); err != nil || !recusado {
			writeJSON(w, http.StatusConflict,
				map[string]string{"error": "este exercício não está sem vídeo"})
			return
		}
	}

	generator, err := h.imageGenerator(ctx, userID)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable,
			map[string]string{"error": "geração de ilustração indisponível no momento"})
		return
	}

	// Reaproveita o que já existe, sem gastar a cota da pessoa.
	var status string
	var updatedAt time.Time
	err = h.db.Pool.QueryRow(ctx,
		`SELECT status, updated_at FROM exercise_illustrations WHERE name_key = $1`, chave).Scan(&status, &updatedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
		return
	}
	if err == nil && (status == "ready" || (status == "pending" && time.Since(updatedAt) < validadePendente)) {
		writeJSON(w, http.StatusOK, respostaIlustracao{Status: status})
		return
	}

	var usadas int
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM exercise_illustration_requests
		 WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`, userID).Scan(&usadas); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
		return
	}
	if usadas >= limiteIlustracoesPorDia {
		writeJSON(w, http.StatusTooManyRequests,
			map[string]string{"error": "limite diário de ilustrações atingido; tente amanhã"})
		return
	}

	// Disputa atômica: o INSERT cria a linha e o UPDATE retoma uma 'failed' ou
	// 'pending' órfã. Quem não ganhar a linha só devolve o estado atual.
	var ganhou bool
	err = h.db.Pool.QueryRow(ctx,
		`WITH claimed AS (
		     INSERT INTO exercise_illustrations (name_key, exercise_name, status, requested_by)
		     VALUES ($1, $2, 'pending', $3)
		     ON CONFLICT (name_key) DO UPDATE
		        SET status = 'pending', error = NULL, requested_by = $3, updated_at = NOW()
		      WHERE exercise_illustrations.status = 'failed'
		         OR (exercise_illustrations.status = 'pending'
		             AND exercise_illustrations.updated_at < NOW() - make_interval(secs => $4))
		     RETURNING 1)
		 SELECT EXISTS (SELECT 1 FROM claimed)`,
		chave, nome, userID, validadePendente.Seconds()).Scan(&ganhou)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao iniciar a geração"})
		return
	}
	if !ganhou {
		writeJSON(w, http.StatusOK, respostaIlustracao{Status: "pending"})
		return
	}
	if _, err := h.db.Pool.Exec(ctx,
		`INSERT INTO exercise_illustration_requests (user_id, name_key) VALUES ($1, $2)`, userID, chave); err != nil {
		slog.Warn("falha ao registrar pedido de ilustração", "erro", err)
	}

	go h.gerar(chave, nome, generator)
	writeJSON(w, http.StatusAccepted, respostaIlustracao{Status: "pending"})
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

func (h *ExerciseIllustrationHandler) gerar(chave, nome string, generator services.ImageGenerator) {
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

	data, mime, err := generator.GenerateImage(ctx, h.model, promptIlustracao(nome))
	if err != nil {
		falhar("não foi possível gerar a ilustração; tente novamente", err)
		return
	}
	data, mime = comprimirImagem(data, mime)
	rel, err := h.gravar(chave, mime, data)
	if err != nil {
		falhar("não foi possível salvar a ilustração; tente novamente", err)
		return
	}
	if _, err := h.db.Pool.Exec(context.Background(),
		`UPDATE exercise_illustrations
		    SET status='ready', storage_path=$2, content_type=$3, error=NULL, updated_at=NOW()
		  WHERE name_key=$1`, chave, rel, mime); err != nil {
		slog.Error("falha ao marcar ilustração como pronta", "erro", err)
	}
}

func promptIlustracao(nome string) string {
	return "Didactic instructional illustration of a person performing the gym exercise \"" + nome + "\". " +
		"Clear, clean flat-style drawing showing the correct execution of the movement, with the start and end " +
		"positions side by side when helpful. Plain light solid background, anatomically correct posture, " +
		"the equipment used in the exercise visible. Absolutely no text, no letters, no numbers, no captions, " +
		"no labels, no watermarks anywhere in the image."
}

// comprimirImagem converte PNG em JPEG: o modelo devolve ~1 MB de PNG, e a
// imagem vai ser guardada no aparelho para uso offline.
func comprimirImagem(data []byte, mime string) ([]byte, string) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, mime
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 82}); err != nil || out.Len() >= len(data) {
		return data, mime
	}
	return out.Bytes(), "image/jpeg"
}

func (h *ExerciseIllustrationHandler) gravar(chave, mime string, data []byte) (string, error) {
	ext := ".png"
	if mime == "image/jpeg" {
		ext = ".jpg"
	} else if mime == "image/webp" {
		ext = ".webp"
	}
	dir := filepath.Join(h.photoDir, pastaIlustracoes)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	nome, err := randomFilename()
	if err != nil {
		return "", err
	}
	rel := filepath.Join(pastaIlustracoes, nome+ext)
	return rel, os.WriteFile(filepath.Join(h.photoDir, rel), data, 0o644)
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
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT status, error, updated_at FROM exercise_illustrations WHERE name_key = $1`,
		chaveIlustracao(nome)).Scan(&status, &msg, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sem ilustração para este exercício"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
		return
	}
	if status == "pending" && time.Since(updatedAt) >= validadePendente {
		// Órfã de um reinício: o app não deve ficar girando para sempre.
		status = "failed"
		m := "a geração foi interrompida; tente novamente"
		msg = &m
	}
	resp := respostaIlustracao{Status: status}
	if msg != nil {
		resp.Error = *msg
	}
	writeJSON(w, http.StatusOK, resp)
}

// Image serve a imagem pronta. Autenticada, e o caminho em disco vem sempre do
// banco, nunca do cliente.
func (h *ExerciseIllustrationHandler) Image(w http.ResponseWriter, r *http.Request) {
	nome, ok := nomeDaQuery(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name inválido"})
		return
	}
	var path, mime string
	var updatedAt time.Time
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT storage_path, content_type, updated_at FROM exercise_illustrations
		 WHERE name_key = $1 AND status = 'ready'`, chaveIlustracao(nome)).Scan(&path, &mime, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ilustração não encontrada"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "falha ao consultar"})
		return
	}
	file, err := os.Open(filepath.Join(h.photoDir, path))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "arquivo não encontrado"})
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(w, r, "", updatedAt, file)
}
