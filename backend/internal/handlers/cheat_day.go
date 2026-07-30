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
	cheatDayChatTimeout   = 60 * time.Second
	maxCheatDayMessage    = 1000
	cheatDayHistoryLimit  = 20
	cheatDayAcceptTimeout = 60 * time.Second
)

const cheatDayChatSystemPrompt = `Você conversa com a pessoa sobre um exagero alimentar planejado ("dia do lixo"), em português do Brasil, antes de propor qualquer compensação. Pergunte o que ela pretende comer e em que contexto (evento, quantidade aproximada) até ter uma ideia razoável do excedente calórico. Seja breve, no máximo 2-3 frases por resposta. Tom de parceria, nunca de julgamento ou culpa. Não calcule números aqui — isso acontece depois, quando a pessoa pedir a compensação. Não faça diagnóstico e não use ferramentas.`

// GetCheatDay returns the currently open session, if any, with its thread.
func (h *NutritionHandler) GetCheatDay(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	session, err := h.loadOpenCheatDaySession(r.Context(), userID)
	if err == pgx.ErrNoRows {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		slog.Error("failed to load cheat day session", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load cheat day session"})
		return
	}
	writeJSON(w, http.StatusOK, session)
}

// SendCheatDayMessage continues (or opens) the one cheat-day conversation a
// person may have at a time — a second exaggeration while one is still open
// continues the same thread instead of starting a parallel one, enforced by
// idx_cheat_day_one_open.
func (h *NutritionHandler) SendCheatDayMessage(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.SendCheatDayMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" || len(req.Content) > maxCheatDayMessage {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("escreva em até %d caracteres", maxCheatDayMessage)})
		return
	}

	chat, err := h.resolver.ChatFor(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "o assistente configurado não responde em texto livre"})
		return
	}

	var sessionID int64
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT id FROM cheat_day_sessions WHERE user_id=$1 AND status='open'`, userID).Scan(&sessionID)
	if err == pgx.ErrNoRows {
		if err := h.db.Pool.QueryRow(r.Context(),
			`INSERT INTO cheat_day_sessions (user_id, happens_on) VALUES ($1, CURRENT_DATE) RETURNING id`,
			userID).Scan(&sessionID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to start cheat day session"})
			return
		}
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load cheat day session"})
		return
	}

	history, err := h.loadCheatDayMessages(r.Context(), sessionID, cheatDayHistoryLimit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load messages"})
		return
	}
	conversation := make([]services.ChatMessage, 0, len(history)+1)
	for _, m := range history {
		conversation = append(conversation, services.ChatMessage{Role: m.Role, Content: m.Content})
	}
	conversation = append(conversation, services.ChatMessage{Role: "user", Content: req.Content})

	chatCtx, cancel := context.WithTimeout(r.Context(), cheatDayChatTimeout)
	defer cancel()
	answer, err := chat.Chat(chatCtx, cheatDayChatSystemPrompt, conversation)
	if err != nil || strings.TrimSpace(answer) == "" {
		slog.Error("cheat day chat failed", "user_id", userID, "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "o assistente está indisponível no momento; tente de novo em instantes"})
		return
	}

	// Both turns are written together, after the answer arrives — the same
	// reason workout_chat.go does it: storing the question first would leave
	// it in the thread with no reply whenever the provider fails.
	if _, err := h.db.Pool.Exec(r.Context(),
		`INSERT INTO cheat_day_messages (session_id, user_id, role, content)
		 VALUES ($1,$2,'user',$3), ($1,$2,'assistant',$4)`,
		sessionID, userID, req.Content, strings.TrimSpace(answer)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save messages"})
		return
	}

	session, err := h.loadCheatDaySession(r.Context(), userID, sessionID)
	if err != nil {
		slog.Error("failed to load cheat day session", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load cheat day session"})
		return
	}
	writeJSON(w, http.StatusOK, session)
}

// AcceptCheatDay turns the conversation into an estimate and a compensation
// training plan. The plan is a separate training_plans row (kind =
// 'compensation'), never a change to the person's real plan — Start,
// CompleteSet, Finish and the guided session all work on it unmodified.
func (h *NutritionHandler) AcceptCheatDay(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	sessionID, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid session id"})
		return
	}

	messages, err := h.loadCheatDayMessages(r.Context(), sessionID, 0)
	if err != nil || len(messages) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "converse antes de pedir a compensação"})
		return
	}
	var owns bool
	_ = h.db.Pool.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM cheat_day_sessions WHERE id=$1 AND user_id=$2 AND status='open')`,
		sessionID, userID).Scan(&owns)
	if !owns {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "cheat day session not found or already resolved"})
		return
	}

	var summaryParts []string
	for _, m := range messages {
		if m.Role == "user" {
			summaryParts = append(summaryParts, m.Content)
		}
	}
	conversationSummary := strings.Join(summaryParts, " | ")

	userContext, err := buildNutritionContext(r.Context(), h.db, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare nutrition context"})
		return
	}

	acceptCtx, cancel := context.WithTimeout(r.Context(), cheatDayAcceptTimeout)
	defer cancel()
	compensation, err := services.NewCheatDayAssistant(h.resolver.For(r.Context(), userID)).
		BuildCompensation(acceptCtx, userContext, conversationSummary)
	if err != nil {
		slog.Error("cheat day compensation failed", "user_id", userID, "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "não foi possível montar a compensação agora; tente de novo"})
		return
	}

	planID, err := h.persistCompensationPlan(r.Context(), userID, compensation.CompensationPlan, compensation.ExpiresInDays)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save compensation plan"})
		return
	}

	var session models.CheatDaySession
	var happensOn time.Time
	err = h.db.Pool.QueryRow(r.Context(),
		`UPDATE cheat_day_sessions
		 SET status='accepted', estimated_calories=$3, summary=$4, compensation_plan_id=$5, updated_at=NOW()
		 WHERE id=$1 AND user_id=$2
		 RETURNING id, status, happens_on, estimated_calories, summary, compensation_plan_id, created_at`,
		sessionID, userID, compensation.EstimatedCalories, compensation.Summary, planID,
	).Scan(&session.ID, &session.Status, &happensOn, &session.EstimatedCalories,
		&session.Summary, &session.CompensationPlanID, &session.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to finalize cheat day session"})
		return
	}
	session.HappensOn = happensOn.Format("2006-01-02")
	writeJSON(w, http.StatusOK, session)
}

// DiscardCheatDay closes an open conversation without a compensation, freeing
// the one-open-session slot so a new one can start.
func (h *NutritionHandler) DiscardCheatDay(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	sessionID, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid session id"})
		return
	}
	tag, err := h.db.Pool.Exec(r.Context(),
		`UPDATE cheat_day_sessions SET status='discarded', updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status='open'`,
		sessionID, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to discard cheat day session"})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "cheat day session not found"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NutritionHandler) loadOpenCheatDaySession(ctx context.Context, userID int64) (*models.CheatDaySession, error) {
	var id int64
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT id FROM cheat_day_sessions WHERE user_id=$1 AND status='open'`, userID).Scan(&id); err != nil {
		return nil, err
	}
	return h.loadCheatDaySession(ctx, userID, id)
}

func (h *NutritionHandler) loadCheatDaySession(ctx context.Context, userID, sessionID int64) (*models.CheatDaySession, error) {
	var session models.CheatDaySession
	var happensOn time.Time
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT id, status, happens_on, estimated_calories, summary, compensation_plan_id, created_at
		 FROM cheat_day_sessions WHERE id=$1 AND user_id=$2`, sessionID, userID,
	).Scan(&session.ID, &session.Status, &happensOn, &session.EstimatedCalories,
		&session.Summary, &session.CompensationPlanID, &session.CreatedAt); err != nil {
		return nil, err
	}
	session.HappensOn = happensOn.Format("2006-01-02")
	messages, err := h.loadCheatDayMessages(ctx, sessionID, 0)
	if err != nil {
		return nil, err
	}
	session.Messages = messages
	return &session, nil
}

func (h *NutritionHandler) loadCheatDayMessages(ctx context.Context, sessionID int64, limit int) ([]models.CheatDayMessage, error) {
	var maximum *int
	if limit > 0 {
		maximum = &limit
	}
	rows, err := h.db.Pool.Query(ctx,
		`SELECT id, role, content, created_at FROM (
		   SELECT id, role, content, created_at FROM cheat_day_messages
		   WHERE session_id = $1 ORDER BY id DESC LIMIT $2::int
		 ) recent ORDER BY id`, sessionID, maximum)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := []models.CheatDayMessage{}
	for rows.Next() {
		var m models.CheatDayMessage
		if err := rows.Scan(&m.ID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, m)
	}
	return messages, rows.Err()
}

// persistCompensationPlan writes the compensation as its own training_plans
// row (kind='compensation', inactive by default, with an expiry date) rather
// than touching the person's real plan. It reuses the same day/exercise
// insert shape TrainingPlanHandler.create uses for a fresh plan — there is
// nothing to reconcile here since the row is always brand new.
func (h *NutritionHandler) persistCompensationPlan(ctx context.Context, userID int64, plan models.TrainingPlanInput, expiresInDays int) (int64, error) {
	tx, err := h.db.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	targetDate := time.Now().AddDate(0, 0, expiresInDays)
	expiresAt := targetDate.Format("2006-01-02")

	var planID int64
	if err := tx.QueryRow(ctx,
		`INSERT INTO training_plans (user_id, name, description, target_date, days_per_week,
		 session_duration_minutes, creation_method, kind, active, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6,'automatic','compensation', false, $7)
		 RETURNING id`,
		userID, planNameOrDefault(plan.Name), plan.Description, targetDate, len(plan.Days),
		defaultSessionDuration(plan), expiresAt,
	).Scan(&planID); err != nil {
		return 0, err
	}

	for dayIndex, day := range plan.Days {
		var dayID int64
		if err := tx.QueryRow(ctx,
			`INSERT INTO training_plan_days (plan_id, day_number, name, focus, instructions)
			 VALUES ($1,$2,$3,$4,$5) RETURNING id`,
			planID, dayIndex+1, strings.TrimSpace(day.Name), strings.TrimSpace(day.Focus), strings.TrimSpace(day.Instructions),
		).Scan(&dayID); err != nil {
			return 0, err
		}
		for exIndex, exercise := range day.Exercises {
			trackingType := exercise.TrackingType
			if trackingType == "" {
				trackingType = "reps"
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO training_plan_exercises (plan_day_id, exercise_order, exercise_name, sets, reps,
				 tracking_type, duration_seconds, rest_seconds, notes)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
				dayID, exIndex+1, strings.TrimSpace(exercise.ExerciseName), exercise.Sets, exercise.Reps,
				trackingType, exercise.DurationSeconds, exercise.RestSeconds, strings.TrimSpace(exercise.Notes)); err != nil {
				return 0, err
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return planID, nil
}

func planNameOrDefault(name string) string {
	if strings.TrimSpace(name) == "" {
		return "Compensação"
	}
	return strings.TrimSpace(name)
}

func defaultSessionDuration(plan models.TrainingPlanInput) int {
	if plan.SessionDurationMinutes > 0 {
		return plan.SessionDurationMinutes
	}
	return 45
}
