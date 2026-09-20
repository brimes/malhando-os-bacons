package models

import "time"

// Gym é um local de treino da pessoa, com os aparelhos disponíveis nele. A
// geração de plano usa isso para só prescrever exercícios executáveis ali.
type Gym struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Notes     string    `json:"notes"`
	Equipment []string  `json:"equipment"`
	CreatedAt time.Time `json:"created_at"`
}

// GymInput é o corpo de POST/PUT /api/gyms.
type GymInput struct {
	Name      string   `json:"name"`
	Notes     string   `json:"notes"`
	Equipment []string `json:"equipment"`
}
