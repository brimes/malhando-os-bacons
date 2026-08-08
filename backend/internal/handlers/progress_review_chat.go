package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

const (
	// Longer than the workout chat's 60s: that question is asked between two
	// series, this one sitting down reading an analysis. The answer is allowed
	// to be a paragraph.
	progressReviewChatTimeout  = 90 * time.Second
	progressReviewHistoryLimit = 20
	maxProgressReviewMessage   = 1500
)

const progressReviewChatSystemPrompt = `Você conversa com a pessoa sobre uma avaliação de progresso que você mesmo produziu, em português do Brasil. Ela acabou de ler a análise e quer entender, discordar ou aprofundar.

Regras:
- Responda com base no histórico e na análise que estão abaixo. Eles são a fonte da verdade: se a pessoa perguntar de onde saiu um número, mostre a conta a partir dos dados fornecidos.
- Se ela apontar que um dado está errado ou que faltou contexto que você não tinha (um treino não registrado, uma refeição não anotada, uma balança diferente), reconheça e diga como isso muda a leitura. Não defenda a análise contra a realidade dela.
- Se a pergunta pedir informação que não está no histórico, diga que não tem esse dado registrado, em vez de estimar.
- Seja direto: no geral 2 a 5 frases, ou uma lista curta. Sem repetir a análise inteira.
- Você NÃO faz diagnóstico médico, não prescreve suplemento, medicamento ou dieta clínica. Diante de sintoma preocupante, oriente procurar um profissional de saúde.
- Você não altera planos nesta conversa. Se ela quiser mudar o treino ou a nutrição, explique que a alteração é confirmada na própria tela da avaliação ou no ajuste do plano.`

// ChatList returns the whole thread of an evaluation, oldest first.
func (h *ProgressReviewHandler) ChatList(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	reviewID, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid review id"})
		return
	}
	if !h.ownsReview(r.Context(), userID, reviewID) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "avaliação não encontrada"})
		return
	}
	messages, err := h.loadChatMessages(r.Context(), reviewID, 0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load chat messages"})
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

// ChatSend answers a question about the evaluation, against the very context
// the evaluation was produced from.
func (h *ProgressReviewHandler) ChatSend(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	reviewID, err := parseReviewIDFromChatPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid review id"})
		return
	}
	var req models.SendProgressReviewMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" || len(req.Message) > maxProgressReviewMessage {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("escreva sua pergunta em até %d caracteres", maxProgressReviewMessage),
		})
		return
	}

	analysisContext, err := h.buildChatContext(r.Context(), userID, reviewID)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "avaliação não encontrada"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare review context"})
		return
	}

	chat, err := h.resolver.ChatFor(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "o assistente configurado não responde em texto livre",
		})
		return
	}

	history, err := h.loadChatMessages(r.Context(), reviewID, progressReviewHistoryLimit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load chat messages"})
		return
	}
	conversation := make([]services.ChatMessage, 0, len(history)+1)
	for _, message := range history {
		conversation = append(conversation, services.ChatMessage{Role: message.Role, Content: message.Content})
	}
	conversation = append(conversation, services.ChatMessage{Role: "user", Content: req.Message})

	chatCtx, cancel := context.WithTimeout(r.Context(), progressReviewChatTimeout)
	defer cancel()
	answer, err := chat.Chat(chatCtx, progressReviewChatSystemPrompt+"\n\n"+analysisContext, conversation)
	if err != nil {
		slog.Error("progress review chat failed", "user_id", userID, "review_id", reviewID, "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "o assistente está indisponível no momento; tente de novo em instantes",
		})
		return
	}
	answer = strings.TrimSpace(answer)
	if answer == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "o assistente não conseguiu responder; tente reformular a pergunta",
		})
		return
	}

	// Both turns written together, after the answer arrives — same reason as
	// workout_chat.go: a question stored up front would sit in the thread with
	// no reply whenever the provider fails.
	rows, err := h.db.Pool.Query(r.Context(),
		`INSERT INTO progress_review_messages (review_id, user_id, role, content)
		 VALUES ($1,$2,'user',$3), ($1,$2,'assistant',$4)
		 RETURNING id, review_id, role, content, created_at`,
		reviewID, userID, req.Message, answer)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save chat messages"})
		return
	}
	defer rows.Close()
	var response models.ProgressReviewChatResponse
	for rows.Next() {
		var message models.ProgressReviewMessage
		if err := rows.Scan(&message.ID, &message.ReviewID, &message.Role, &message.Content, &message.CreatedAt); err != nil {
			continue
		}
		if message.Role == "user" {
			response.UserMessage = message
			continue
		}
		response.Message = message
	}
	if response.Message.ID == 0 {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save chat messages"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

// buildChatContext hands the model the analysis it wrote plus the history that
// produced it. The history is the stored snapshot, not a fresh read: the whole
// point of the conversation is to explain the numbers in the text above it, and
// today's data would quietly disagree with them.
func (h *ProgressReviewHandler) buildChatContext(ctx context.Context, userID, reviewID int64) (string, error) {
	var status, performance, goalAssessment, goalStatus, snapshot string
	var trainingSummary, nutritionSummary string
	var periodStart, periodEnd time.Time
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT status, period_start, period_end, performance, goal_assessment, goal_status,
		        training_summary, nutrition_summary, context_snapshot
		 FROM progress_reviews WHERE id=$1 AND user_id=$2`, reviewID, userID,
	).Scan(&status, &periodStart, &periodEnd, &performance, &goalAssessment, &goalStatus,
		&trainingSummary, &nutritionSummary, &snapshot); err != nil {
		return "", err
	}

	var builder strings.Builder
	fmt.Fprintf(&builder, "AVALIAÇÃO EM DISCUSSÃO (período de %s a %s, situação do objetivo: %s).\n\n",
		periodStart.Format("2006-01-02"), periodEnd.Format("2006-01-02"), goalStatus)
	builder.WriteString("Desempenho que você escreveu:\n" + performance + "\n\n")
	builder.WriteString("Objetivo que você escreveu:\n" + goalAssessment + "\n\n")
	if strings.TrimSpace(trainingSummary) != "" {
		builder.WriteString("Alteração de treino que você propôs:\n" + trainingSummary + "\n\n")
	}
	if strings.TrimSpace(nutritionSummary) != "" {
		builder.WriteString("Alteração de nutrição que você propôs:\n" + nutritionSummary + "\n\n")
	}
	switch status {
	case "applied":
		builder.WriteString("A pessoa já confirmou a alteração proposta; os planos foram atualizados.\n\n")
	case "discarded":
		builder.WriteString("A pessoa optou por manter os planos como estavam.\n\n")
	}
	// An evaluation from before the snapshot column existed has none. The
	// conversation still works off the analysis itself — thinner, but honest.
	if strings.TrimSpace(snapshot) != "" {
		builder.WriteString("HISTÓRICO EM QUE A ANÁLISE SE BASEOU:\n" + snapshot)
	}
	return builder.String(), nil
}

func (h *ProgressReviewHandler) ownsReview(ctx context.Context, userID, reviewID int64) bool {
	var exists bool
	_ = h.db.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM progress_reviews WHERE id=$1 AND user_id=$2)`,
		reviewID, userID).Scan(&exists)
	return exists
}

func (h *ProgressReviewHandler) loadChatMessages(ctx context.Context, reviewID int64, limit int) ([]models.ProgressReviewMessage, error) {
	var maximum *int
	if limit > 0 {
		maximum = &limit
	}
	rows, err := h.db.Pool.Query(ctx,
		`SELECT id, review_id, role, content, created_at FROM (
		   SELECT id, review_id, role, content, created_at FROM progress_review_messages
		   WHERE review_id = $1 ORDER BY id DESC LIMIT $2::int
		 ) recent ORDER BY id`, reviewID, maximum)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := []models.ProgressReviewMessage{}
	for rows.Next() {
		var message models.ProgressReviewMessage
		if err := rows.Scan(&message.ID, &message.ReviewID, &message.Role, &message.Content, &message.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

// parseReviewIDFromChatPath reads the id from /api/progress-reviews/{id}/chat.
func parseReviewIDFromChatPath(path string) (int64, error) {
	return parseWorkoutIDFromSessionPath(path)
}
