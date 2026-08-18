package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

const (
	// Roda síncrono: é uma pergunta curta por turno, bem dentro do WriteTimeout,
	// ao contrário da geração de plano.
	nutritionLogAssistantTimeout = 60 * time.Second
	maxNutritionLogMessage       = 1000
	// A conversa inteira vai e volta a cada turno; sem teto, uma thread longa
	// cresceria o prompt sem limite.
	maxNutritionLogTurns = 24
)

// LogAssistant conduz um turno da conversa de registro. Não grava nada: quem
// grava é o app, pelos endpoints de log que já existem, depois que a pessoa
// confere a lista na tela.
func (h *NutritionHandler) LogAssistant(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())

	var req models.NutritionLogAssistantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if len(req.Messages) == 0 || len(req.Messages) > maxNutritionLogTurns {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversa vazia ou longa demais"})
		return
	}

	conversation := make([]services.ChatMessage, 0, len(req.Messages))
	for _, m := range req.Messages {
		content := strings.TrimSpace(m.Content)
		if content == "" || len(content) > maxNutritionLogMessage {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "mensagem vazia ou longa demais"})
			return
		}
		role := "user"
		if m.Role == "assistant" {
			role = "assistant"
		}
		conversation = append(conversation, services.ChatMessage{Role: role, Content: content})
	}

	// Contexto enxuto de propósito: para estimar uma pizza não é preciso o
	// histórico inteiro de treinos. Perfil e metas bastam, e mantêm o prompt
	// pequeno num endpoint que roda a cada mensagem digitada.
	userContext := "sem perfil registrado"
	var caloriesTarget int
	var proteinTarget float64
	if h.db.Pool.QueryRow(r.Context(),
		`SELECT calories_target, protein_target FROM nutrition_plans WHERE user_id=$1 AND active=true LIMIT 1`,
		userID).Scan(&caloriesTarget, &proteinTarget) == nil {
		userContext = fmt.Sprintf("metas diárias: %d kcal e %.0fg de proteína", caloriesTarget, proteinTarget)
	}

	hoje := time.Now().Format("2006-01-02")
	ctx, cancel := context.WithTimeout(r.Context(), nutritionLogAssistantTimeout)
	defer cancel()

	draft, err := services.NewNutritionLogAssistant(h.resolver.For(r.Context(), userID)).
		Next(ctx, userContext, hoje, conversation)
	if err != nil {
		slog.Error("nutrition log assistant failed", "user_id", userID, "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "o assistente está indisponível no momento; tente de novo em instantes",
		})
		return
	}

	// A data vem do assistente resolvendo "ontem à noite", e um erro dele viraria
	// um registro num dia que a pessoa não vai procurar. Data inválida ou no
	// futuro cai para hoje; o app mostra a data de cada item antes de gravar.
	for i := range draft.Entries {
		entry := &draft.Entries[i]
		parsed, parseErr := time.Parse("2006-01-02", entry.Date)
		if parseErr != nil || parsed.After(time.Now()) {
			entry.Date = hoje
		}
		if entry.QuantityG <= 0 {
			entry.QuantityG = 100
		}
	}

	writeJSON(w, http.StatusOK, draft)
}
