package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
	"github.com/mob/backend/internal/services"
)

const (
	// workoutChatTimeout is short on purpose: the question is asked between two
	// series, on a phone. An answer that takes longer than this is useless.
	workoutChatTimeout = 60 * time.Second
	// workoutChatHistoryLimit bounds how much of the thread is replayed to the
	// model, so a long session does not grow the prompt without limit.
	workoutChatHistoryLimit = 20
	maxWorkoutChatMessage   = 1000
)

type WorkoutChatHandler struct {
	db       *db.DB
	resolver services.GeneratorResolver
}

func NewWorkoutChatHandler(database *db.DB, resolver services.GeneratorResolver) *WorkoutChatHandler {
	return &WorkoutChatHandler{db: database, resolver: resolver}
}

// List returns the whole thread for a workout, in chronological order.
func (h *WorkoutChatHandler) List(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	workoutID, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout id"})
		return
	}
	owns, err := h.ownsWorkout(r.Context(), userID, workoutID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load workout"})
		return
	}
	if !owns {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workout not found"})
		return
	}

	messages, err := h.loadMessages(r.Context(), workoutID, 0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load chat messages"})
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

// Send answers a question about the workout and stores both turns. It works for
// a session in progress and for one already finished, so a doubt that only
// comes up afterwards still has somewhere to go.
func (h *WorkoutChatHandler) Send(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	workoutID, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid workout id"})
		return
	}
	var req models.WorkoutChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" || len(req.Message) > maxWorkoutChatMessage {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("escreva sua dúvida em até %d caracteres", maxWorkoutChatMessage),
		})
		return
	}

	owns, err := h.ownsWorkout(r.Context(), userID, workoutID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load workout"})
		return
	}
	if !owns {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workout not found"})
		return
	}

	// A geração estruturada é sempre possível — o resolver cai para o crédito
	// compartilhado quando o provedor da pessoa falha ao construir — então,
	// diferente do texto livre de antes, não há um caso de "provedor não
	// suporta" a tratar aqui.
	assistant := services.NewWorkoutChatAssistant(h.resolver.For(r.Context(), userID))

	workoutContext, exerciseIDs, err := h.buildWorkoutContext(r.Context(), userID, workoutID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare workout context"})
		return
	}
	history, err := h.loadMessages(r.Context(), workoutID, workoutChatHistoryLimit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load chat messages"})
		return
	}

	conversation := make([]services.ChatMessage, 0, len(history)+1)
	for _, message := range history {
		conversation = append(conversation, services.ChatMessage{Role: message.Role, Content: message.Content})
	}
	conversation = append(conversation, services.ChatMessage{Role: "user", Content: req.Message})

	chatCtx, cancel := context.WithTimeout(r.Context(), workoutChatTimeout)
	defer cancel()
	draft, err := assistant.Reply(chatCtx, workoutContext, conversation)
	if err != nil {
		slog.Error("workout chat failed", "user_id", userID, "workout_id", workoutID, "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "o assistente está indisponível no momento; tente de novo em instantes",
		})
		return
	}
	answer := strings.TrimSpace(draft.Answer)
	if answer == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "o assistente não conseguiu responder; tente reformular a pergunta",
		})
		return
	}

	// A proposta só é honrada se apontar para um exercício real do treino de
	// hoje — o schema pede isso ao modelo, mas nada obriga ele a obedecer, e
	// aceitar um id fora da lista aplicaria a troca no exercício errado (ou
	// falharia com 400 lá na frente, sem a pessoa entender por quê).
	substitution := draft.Substitution
	if substitution != nil && !exerciseIDs[substitution.TrainingPlanExerciseID] {
		slog.Warn("assistente propôs troca para exercício fora do treino de hoje",
			"user_id", userID, "workout_id", workoutID, "training_plan_exercise_id", substitution.TrainingPlanExerciseID)
		substitution = nil
	}

	// Both turns are written together, after the answer arrives: storing the
	// question up front would leave it in the thread with no reply whenever the
	// provider fails, and the person would have no way to retry it. The
	// substitution proposal itself is not persisted — it lives only in this
	// response, and the screen either applies it right away or lets it go.
	rows, err := h.db.Pool.Query(r.Context(),
		`INSERT INTO workout_chat_messages (workout_id, user_id, role, content)
		 VALUES ($1, $2, 'user', $3), ($1, $2, 'assistant', $4)
		 RETURNING id, workout_id, role, content, created_at`,
		workoutID, userID, req.Message, answer)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save chat messages"})
		return
	}
	defer rows.Close()
	response := models.WorkoutChatResponse{Substitution: substitution}
	for rows.Next() {
		var message models.WorkoutChatMessage
		if err := rows.Scan(&message.ID, &message.WorkoutID, &message.Role, &message.Content, &message.CreatedAt); err != nil {
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

func (h *WorkoutChatHandler) ownsWorkout(ctx context.Context, userID, workoutID int64) (bool, error) {
	var exists bool
	err := h.db.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM workouts WHERE id = $1 AND user_id = $2)`, workoutID, userID).Scan(&exists)
	return exists, err
}

// loadMessages returns the thread in chronological order. limit > 0 keeps only
// the most recent messages, which is what gets replayed to the model.
func (h *WorkoutChatHandler) loadMessages(ctx context.Context, workoutID int64, limit int) ([]models.WorkoutChatMessage, error) {
	// A limit of 0 means "everything"; NULL disables the LIMIT clause without a
	// second query.
	var maximum *int
	if limit > 0 {
		maximum = &limit
	}
	rows, err := h.db.Pool.Query(ctx,
		`SELECT id, workout_id, role, content, created_at FROM (
		   SELECT id, workout_id, role, content, created_at FROM workout_chat_messages
		   WHERE workout_id = $1 ORDER BY id DESC LIMIT $2::int
		 ) recent ORDER BY id`, workoutID, maximum)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := []models.WorkoutChatMessage{}
	for rows.Next() {
		var message models.WorkoutChatMessage
		if err := rows.Scan(&message.ID, &message.WorkoutID, &message.Role, &message.Content, &message.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

// buildWorkoutContext describes the session the question is about: the plan for
// the day, what has already been done and who the person is. The returned map
// lists the training_plan_exercise ids that exist in today's day — the only
// ones a substitution proposal may legitimately point at; Send rejects
// anything else instead of trusting the model's output.
func (h *WorkoutChatHandler) buildWorkoutContext(ctx context.Context, userID, workoutID int64) (string, map[int64]bool, error) {
	var name, status string
	var date time.Time
	var planDayID *int64
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT name, date, status, training_plan_day_id FROM workouts WHERE id = $1 AND user_id = $2`,
		workoutID, userID).Scan(&name, &date, &status, &planDayID); err != nil {
		return "", nil, err
	}

	var summary strings.Builder
	fmt.Fprintf(&summary, "Treino atual: %q, data %s, situação %s.\n",
		name, date.Format("2006-01-02"), translateWorkoutStatus(status))

	exerciseIDs := map[int64]bool{}
	if planDayID != nil {
		var dayName, focus, instructions string
		var planID int64
		if err := h.db.Pool.QueryRow(ctx,
			`SELECT d.name, d.focus, d.instructions, p.id
			 FROM training_plan_days d JOIN training_plans p ON p.id = d.plan_id
			 WHERE d.id = $1`, planDayID,
		).Scan(&dayName, &focus, &instructions, &planID); err == nil {
			fmt.Fprintf(&summary, "Dia do plano: %s (foco: %s). Instruções: %s\n", dayName, focus, instructions)

			// Mesma regra do ajuste de plano (Adjust em training_plan_adjust.go):
			// uma troca sugerida aqui também tem de caber nos aparelhos da
			// academia, quando há uma vinculada ao plano.
			var gymID *int64
			if err := h.db.Pool.QueryRow(ctx,
				`SELECT gym_id FROM training_plans WHERE id = $1`, planID).Scan(&gymID); err == nil {
				if gymContext, gymErr := buildGymContext(ctx, h.db, userID, gymID); gymErr == nil && gymContext != "" {
					summary.WriteString(gymContext + "\n")
				}
			}
		}
		rows, err := h.db.Pool.Query(ctx,
			`SELECT id, exercise_name, sets, reps, tracking_type, duration_seconds, rest_seconds, notes, last_weight_kg
			 FROM training_plan_exercises WHERE plan_day_id = $1 ORDER BY exercise_order`, *planDayID)
		if err != nil {
			return "", nil, err
		}
		summary.WriteString("Exercícios previstos para hoje (id é o que vai em substitution.training_plan_exercise_id):\n")
		for rows.Next() {
			var id int64
			var exerciseName, trackingType, notes string
			var sets, reps, restSeconds int
			var durationSeconds *int
			var lastWeight *float64
			if err := rows.Scan(&id, &exerciseName, &sets, &reps, &trackingType, &durationSeconds,
				&restSeconds, &notes, &lastWeight); err != nil {
				continue
			}
			exerciseIDs[id] = true
			target := fmt.Sprintf("%dx%d repetições", sets, reps)
			if trackingType == "time" && durationSeconds != nil {
				target = fmt.Sprintf("%d séries de %ds", sets, *durationSeconds)
			}
			line := fmt.Sprintf("- id=%d %s: %s, descanso %ds", id, exerciseName, target, restSeconds)
			if lastWeight != nil && *lastWeight > 0 {
				line += fmt.Sprintf(", última carga %.1fkg", *lastWeight)
			}
			if strings.TrimSpace(notes) != "" {
				line += ", observação: " + notes
			}
			summary.WriteString(line + "\n")
		}
		rows.Close()
	}

	setRows, err := h.db.Pool.Query(ctx,
		`SELECT exercise_name, COUNT(*), MAX(weight_kg) FROM workout_sets
		 WHERE workout_id = $1 GROUP BY exercise_name ORDER BY MIN(id)`, workoutID)
	if err != nil {
		return "", nil, err
	}
	defer setRows.Close()
	done := []string{}
	for setRows.Next() {
		var exerciseName string
		var count int
		var weight float64
		if err := setRows.Scan(&exerciseName, &count, &weight); err != nil {
			continue
		}
		entry := fmt.Sprintf("%s: %d série(s)", exerciseName, count)
		if weight > 0 {
			entry += fmt.Sprintf(" com até %.1fkg", weight)
		}
		done = append(done, entry)
	}
	if len(done) == 0 {
		summary.WriteString("Séries já feitas neste treino: nenhuma ainda.\n")
	} else {
		summary.WriteString("Séries já feitas neste treino: " + strings.Join(done, "; ") + ".\n")
	}

	// A missing profile must not block an answer — it only makes the context
	// thinner, which the prompt already tolerates.
	userContext, err := buildUserContext(ctx, h.db, userID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", nil, err
	}
	if userContext != "" {
		summary.WriteString("Contexto da pessoa: " + userContext + "\n")
	}
	return summary.String(), exerciseIDs, nil
}

func translateWorkoutStatus(status string) string {
	switch status {
	case "in_progress":
		return "em andamento"
	case "completed":
		return "concluído"
	default:
		return status
	}
}
