package models

import "time"

type WorkoutChatMessage struct {
	ID        int64     `json:"id"`
	WorkoutID int64     `json:"workout_id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

type WorkoutChatRequest struct {
	Message string `json:"message"`
}

// WorkoutChatResponse echoes the question back together with the answer so the
// screen can render both from a single reply, without guessing ids.
type WorkoutChatResponse struct {
	UserMessage WorkoutChatMessage `json:"user_message"`
	Message     WorkoutChatMessage `json:"message"`
	// Substitution só vem preenchido quando a pessoa pediu para trocar o
	// exercício ou disse que não consegue fazê-lo. Não é persistido junto da
	// mensagem: é uma proposta viva desta resposta, aplicada (ou descartada)
	// na hora pela tela via POST /workouts/{id}/substitutions.
	Substitution *WorkoutChatSubstitution `json:"substitution,omitempty"`
}

// WorkoutChatSubstitution é a troca de exercício que o assistente propõe.
// training_plan_exercise_id tem de ser um dos exercícios do treino de hoje —
// o handler confere isso antes de devolver a proposta, nunca confia cegamente
// no que o modelo escreveu.
type WorkoutChatSubstitution struct {
	TrainingPlanExerciseID int64  `json:"training_plan_exercise_id"`
	NewName                string `json:"new_name"`
	Sets                   int    `json:"sets"`
	Reps                   int    `json:"reps"`
	TrackingType           string `json:"tracking_type"`
	DurationSeconds        *int   `json:"duration_seconds"`
	RestSeconds            int    `json:"rest_seconds"`
	Notes                  string `json:"notes"`
	// Reason é a frase curta que explica a escolha — mostrada no cartão de
	// confirmação, não só no texto corrido da resposta.
	Reason string `json:"reason"`
}
