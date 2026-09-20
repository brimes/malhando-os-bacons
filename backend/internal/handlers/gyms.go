package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

type GymHandler struct {
	db *db.DB
}

func NewGymHandler(database *db.DB) *GymHandler {
	return &GymHandler{db: database}
}

func (h *GymHandler) List(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, name, notes, created_at FROM gyms WHERE user_id = $1 ORDER BY name`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load gyms"})
		return
	}
	defer rows.Close()
	gyms := []models.Gym{}
	ids := []int64{}
	byID := map[int64]*models.Gym{}
	for rows.Next() {
		var g models.Gym
		if err := rows.Scan(&g.ID, &g.Name, &g.Notes, &g.CreatedAt); err != nil {
			continue
		}
		g.Equipment = []string{}
		gyms = append(gyms, g)
		ids = append(ids, g.ID)
	}
	for i := range gyms {
		byID[gyms[i].ID] = &gyms[i]
	}
	if len(ids) > 0 {
		if err := h.loadEquipment(r.Context(), ids, byID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load gym equipment"})
			return
		}
	}
	writeJSON(w, http.StatusOK, gyms)
}

// loadEquipment preenche o Equipment de cada academia em byID com uma única
// query, em vez de uma por academia — a lista raramente passa de poucas
// academias, mas não custa nada fazer certo.
func (h *GymHandler) loadEquipment(ctx context.Context, gymIDs []int64, byID map[int64]*models.Gym) error {
	rows, err := h.db.Pool.Query(ctx,
		`SELECT gym_id, name FROM gym_equipment WHERE gym_id = ANY($1) ORDER BY name`, gymIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var gymID int64
		var name string
		if err := rows.Scan(&gymID, &name); err != nil {
			continue
		}
		if gym, ok := byID[gymID]; ok {
			gym.Equipment = append(gym.Equipment, name)
		}
	}
	return nil
}

func (h *GymHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid gym id"})
		return
	}
	gym, err := h.loadOne(r.Context(), id, userID)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "gym not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load gym"})
		return
	}
	writeJSON(w, http.StatusOK, gym)
}

func (h *GymHandler) loadOne(ctx context.Context, id, userID int64) (*models.Gym, error) {
	var gym models.Gym
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT id, name, notes, created_at FROM gyms WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&gym.ID, &gym.Name, &gym.Notes, &gym.CreatedAt); err != nil {
		return nil, err
	}
	gym.Equipment = []string{}
	rows, err := h.db.Pool.Query(ctx, `SELECT name FROM gym_equipment WHERE gym_id = $1 ORDER BY name`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil {
			gym.Equipment = append(gym.Equipment, name)
		}
	}
	return &gym, nil
}

func (h *GymHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var input models.GymInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	equipment, err := validateGymInput(&input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create gym"})
		return
	}
	defer tx.Rollback(r.Context())

	var gym models.Gym
	if err := tx.QueryRow(r.Context(),
		`INSERT INTO gyms (user_id, name, notes) VALUES ($1,$2,$3) RETURNING id, name, notes, created_at`,
		userID, input.Name, input.Notes,
	).Scan(&gym.ID, &gym.Name, &gym.Notes, &gym.CreatedAt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create gym"})
		return
	}
	if err := insertEquipment(r.Context(), tx, gym.ID, equipment); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save equipment"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create gym"})
		return
	}
	gym.Equipment = equipment
	writeJSON(w, http.StatusCreated, gym)
}

// Update substitui o conjunto de aparelhos inteiro (DELETE + INSERT na mesma
// transação) em vez de tentar diffar: a tela sempre manda a lista completa, e
// diffar uma lista pequena não vale a complexidade de preservar ids que
// ninguém referencia (equipamento não é apontado por nenhuma outra tabela).
func (h *GymHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid gym id"})
		return
	}
	var input models.GymInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	equipment, err := validateGymInput(&input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update gym"})
		return
	}
	defer tx.Rollback(r.Context())

	var gym models.Gym
	err = tx.QueryRow(r.Context(),
		`UPDATE gyms SET name=$3, notes=$4, updated_at=NOW() WHERE id=$1 AND user_id=$2
		 RETURNING id, name, notes, created_at`,
		id, userID, input.Name, input.Notes,
	).Scan(&gym.ID, &gym.Name, &gym.Notes, &gym.CreatedAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "gym not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update gym"})
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM gym_equipment WHERE gym_id = $1`, gym.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save equipment"})
		return
	}
	if err := insertEquipment(r.Context(), tx, gym.ID, equipment); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save equipment"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update gym"})
		return
	}
	gym.Equipment = equipment
	writeJSON(w, http.StatusOK, gym)
}

// Delete usa ON DELETE SET NULL em training_plans.gym_id — nunca apaga o
// plano que foi gerado com esta academia, só desvincula.
func (h *GymHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid gym id"})
		return
	}
	tag, err := h.db.Pool.Exec(r.Context(), `DELETE FROM gyms WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete gym"})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "gym not found"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// validateGymInput normaliza e valida, devolvendo a lista de equipamentos já
// limpa (vazios descartados, duplicados por caixa/espaço removidos mantendo a
// grafia da primeira ocorrência).
func validateGymInput(input *models.GymInput) ([]string, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 80 {
		return nil, fmt.Errorf("name must be between 1 and 80 characters")
	}
	input.Notes = strings.TrimSpace(input.Notes)
	if len(input.Notes) > 500 {
		return nil, fmt.Errorf("notes must be at most 500 characters")
	}
	if len(input.Equipment) > 100 {
		return nil, fmt.Errorf("at most 100 pieces of equipment are allowed")
	}
	seen := map[string]bool{}
	equipment := make([]string, 0, len(input.Equipment))
	for _, raw := range input.Equipment {
		item := strings.TrimSpace(raw)
		if item == "" {
			continue
		}
		if len(item) > 60 {
			return nil, fmt.Errorf("each piece of equipment must be at most 60 characters")
		}
		key := strings.ToLower(item)
		if seen[key] {
			continue
		}
		seen[key] = true
		equipment = append(equipment, item)
	}
	sort.Strings(equipment)
	return equipment, nil
}

func insertEquipment(ctx context.Context, tx pgx.Tx, gymID int64, equipment []string) error {
	for _, name := range equipment {
		if _, err := tx.Exec(ctx,
			`INSERT INTO gym_equipment (gym_id, name) VALUES ($1,$2) ON CONFLICT (gym_id, name) DO NOTHING`,
			gymID, name); err != nil {
			return err
		}
	}
	return nil
}
