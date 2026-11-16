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

	hoje := resolveToday(req.Today, time.Now())
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
		_, parseErr := time.Parse("2006-01-02", entry.Date)
		if parseErr != nil || entry.Date > hoje {
			entry.Date = hoje
		}
		if entry.QuantityG <= 0 {
			entry.QuantityG = 100
		}
	}

	writeJSON(w, http.StatusOK, draft)
}

// userFallbackLocation é o fuso do produto quando o app não manda "today".
func userFallbackLocation() *time.Location {
	loc, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		return time.UTC
	}
	return loc
}

// resolveToday devolve o "hoje" do usuário. O app manda a data local do
// aparelho; só é aceita se for YYYY-MM-DD válida e a até 1 dia do UTC do
// servidor (cobre todos os fusos reais). Senão, usa Brasília — nunca o UTC
// do pod, que à noite já está no dia seguinte.
func resolveToday(client string, now time.Time) string {
	if parsed, err := time.Parse("2006-01-02", client); err == nil {
		utcDay, _ := time.Parse("2006-01-02", now.UTC().Format("2006-01-02"))
		diff := parsed.Sub(utcDay)
		if diff >= -24*time.Hour && diff <= 24*time.Hour {
			return client
		}
	}
	return now.In(userFallbackLocation()).Format("2006-01-02")
}
