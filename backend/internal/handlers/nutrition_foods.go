package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

// SearchFoods looks across the shared catalog and this user's own foods. It
// still requires internet on the client (the catalog is not synced to the
// device), but personal foods are few and cached, so the app also serves them
// from the offline read-through cache.
func (h *NutritionHandler) SearchFoods(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "query parameter 'q' is required"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, user_id, name, brand, calories_per_100g, protein_g, carbs_g, fat_g, fiber_g, sodium_mg,
		        serving_label, serving_grams, COALESCE(source,''), archived, created_at,
		        (SELECT mp.id FROM meal_photos mp WHERE mp.food_item_id = food_items.id ORDER BY mp.created_at DESC LIMIT 1)
		 FROM food_items
		 WHERE (user_id IS NULL OR user_id = $2) AND NOT archived AND search_text LIKE '%' || $1 || '%'
		 ORDER BY (user_id IS NOT NULL) DESC, name LIMIT 20`,
		normalizeSearchText(q), userID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "search failed"})
		return
	}
	defer rows.Close()

	foods := []models.FoodItem{}
	for rows.Next() {
		var f models.FoodItem
		if err := rows.Scan(&f.ID, &f.UserID, &f.Name, &f.Brand, &f.CaloriesPer100g, &f.ProteinG, &f.CarbsG, &f.FatG,
			&f.FiberG, &f.SodiumMg, &f.ServingLabel, &f.ServingGrams, &f.Source, &f.Archived, &f.CreatedAt, &f.CoverPhotoID); err != nil {
			continue
		}
		foods = append(foods, f)
	}

	writeJSON(w, http.StatusOK, foods)
}

// ListPersonalFoods returns this user's own foods, cacheable offline.
func (h *NutritionHandler) ListPersonalFoods(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, user_id, name, brand, calories_per_100g, protein_g, carbs_g, fat_g, fiber_g, sodium_mg,
		        serving_label, serving_grams, COALESCE(source,''), archived, created_at,
		        (SELECT mp.id FROM meal_photos mp WHERE mp.food_item_id = food_items.id ORDER BY mp.created_at DESC LIMIT 1)
		 FROM food_items WHERE user_id = $1 AND NOT archived ORDER BY name`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch foods"})
		return
	}
	defer rows.Close()
	foods := []models.FoodItem{}
	for rows.Next() {
		var f models.FoodItem
		if err := rows.Scan(&f.ID, &f.UserID, &f.Name, &f.Brand, &f.CaloriesPer100g, &f.ProteinG, &f.CarbsG, &f.FatG,
			&f.FiberG, &f.SodiumMg, &f.ServingLabel, &f.ServingGrams, &f.Source, &f.Archived, &f.CreatedAt, &f.CoverPhotoID); err != nil {
			continue
		}
		foods = append(foods, f)
	}
	writeJSON(w, http.StatusOK, foods)
}

func (h *NutritionHandler) CreatePersonalFood(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.CreateFoodItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if err := validateFoodItemRequest(req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	var f models.FoodItem
	err := h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO food_items (user_id, name, brand, calories_per_100g, protein_g, carbs_g, fat_g, fiber_g, sodium_mg,
		 serving_label, serving_grams, source, search_text)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'user',$12)
		 RETURNING id, user_id, name, brand, calories_per_100g, protein_g, carbs_g, fat_g, fiber_g, sodium_mg,
		 serving_label, serving_grams, COALESCE(source,''), archived, created_at`,
		userID, strings.TrimSpace(req.Name), strings.TrimSpace(req.Brand), req.CaloriesPer100g, req.ProteinG,
		req.CarbsG, req.FatG, req.FiberG, req.SodiumMg, strings.TrimSpace(req.ServingLabel), nullableFloat(req.ServingGrams),
		normalizeSearchText(req.Name+" "+req.Brand),
	).Scan(&f.ID, &f.UserID, &f.Name, &f.Brand, &f.CaloriesPer100g, &f.ProteinG, &f.CarbsG, &f.FatG,
		&f.FiberG, &f.SodiumMg, &f.ServingLabel, &f.ServingGrams, &f.Source, &f.Archived, &f.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "você já tem um alimento com esse nome e marca"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create food"})
		return
	}
	if req.PhotoID != nil {
		if _, err := h.db.Pool.Exec(r.Context(),
			`UPDATE meal_photos SET food_item_id=$1 WHERE id=$2 AND user_id=$3`, f.ID, *req.PhotoID, userID); err == nil {
			f.CoverPhotoID = req.PhotoID
		}
	}
	writeJSON(w, http.StatusCreated, f)
}

func (h *NutritionHandler) UpdatePersonalFood(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid food id"})
		return
	}
	var req models.CreateFoodItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if err := validateFoodItemRequest(req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	var f models.FoodItem
	err = h.db.Pool.QueryRow(r.Context(),
		`UPDATE food_items SET name=$3, brand=$4, calories_per_100g=$5, protein_g=$6, carbs_g=$7, fat_g=$8,
		 fiber_g=$9, sodium_mg=$10, serving_label=$11, serving_grams=$12, search_text=$13, updated_at=NOW()
		 WHERE id=$1 AND user_id=$2
		 RETURNING id, user_id, name, brand, calories_per_100g, protein_g, carbs_g, fat_g, fiber_g, sodium_mg,
		 serving_label, serving_grams, COALESCE(source,''), archived, created_at`,
		id, userID, strings.TrimSpace(req.Name), strings.TrimSpace(req.Brand), req.CaloriesPer100g, req.ProteinG,
		req.CarbsG, req.FatG, req.FiberG, req.SodiumMg, strings.TrimSpace(req.ServingLabel), nullableFloat(req.ServingGrams),
		normalizeSearchText(req.Name+" "+req.Brand),
	).Scan(&f.ID, &f.UserID, &f.Name, &f.Brand, &f.CaloriesPer100g, &f.ProteinG, &f.CarbsG, &f.FatG,
		&f.FiberG, &f.SodiumMg, &f.ServingLabel, &f.ServingGrams, &f.Source, &f.Archived, &f.CreatedAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "food not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update food"})
		return
	}
	writeJSON(w, http.StatusOK, f)
}

// DeletePersonalFood archives instead of deleting outright: nutrition_plan_meal_items
// and food_logs reference this row (ON DELETE SET NULL), and archiving keeps
// the food_name snapshot meaningful without a dangling id anywhere it still
// matters, while removing it from search and the personal list.
func (h *NutritionHandler) DeletePersonalFood(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid food id"})
		return
	}
	tag, err := h.db.Pool.Exec(r.Context(),
		`UPDATE food_items SET archived = true, updated_at = NOW() WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete food"})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "food not found"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func validateFoodItemRequest(req models.CreateFoodItemRequest) error {
	if strings.TrimSpace(req.Name) == "" {
		return fmt.Errorf("name é obrigatório")
	}
	if req.CaloriesPer100g < 0 || req.CaloriesPer100g > 900 {
		return fmt.Errorf("calories_per_100g deve estar entre 0 e 900")
	}
	if req.ProteinG < 0 || req.ProteinG > 100 || req.CarbsG < 0 || req.CarbsG > 100 || req.FatG < 0 || req.FatG > 100 {
		return fmt.Errorf("protein_g, carbs_g e fat_g devem estar entre 0 e 100")
	}
	return nil
}

func nullableFloat(v float64) *float64 {
	if v <= 0 {
		return nil
	}
	return &v
}

// normalizeSearchText folds accents and lowercases, mirroring what migration
// 017 does in SQL for the existing seed. CREATE EXTENSION (unaccent/pg_trgm)
// was deliberately avoided: it usually needs a superuser, and the app
// connects as a regular one — a failure there would fail inside the
// migration's advisory lock and take the whole boot down with it.
func normalizeSearchText(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		b.WriteRune(foldAccent(r))
	}
	return strings.TrimSpace(b.String())
}

func foldAccent(r rune) rune {
	switch {
	case strings.ContainsRune("áàâãä", r):
		return 'a'
	case strings.ContainsRune("éèêë", r):
		return 'e'
	case strings.ContainsRune("íìîï", r):
		return 'i'
	case strings.ContainsRune("óòôõö", r):
		return 'o'
	case strings.ContainsRune("úùûü", r):
		return 'u'
	case r == 'ç':
		return 'c'
	case unicode.IsSpace(r):
		return ' '
	default:
		return r
	}
}
