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
}
