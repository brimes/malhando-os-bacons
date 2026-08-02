package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

// groupKeyFor is the single source of truth for how a log or a favorite is
// grouped: an item-backed row groups by the catalog id, everything else
// (photo estimate, manual entry) groups by its normalized name.
// normalizeSearchText (nutrition_foods.go) and this must never drift from the
// equivalent SQL expression in historyQuery below — a mismatch is silent: the
// star just fails to show up on an already-favorited row.
func groupKeyFor(foodItemID *int64, foodName string) string {
	if foodItemID != nil {
		return "item:" + strconv.FormatInt(*foodItemID, 10)
	}
	return "name:" + normalizeSearchText(foodName)
}

// historyQuery consolidates this user's food_logs by group_key, left-joins
// favorites onto matching groups, and unions in favorites whose entire log
// history was since deleted (times_logged 0, last_logged_at null). Ordering:
// favorites first as a block, sorted by last use (falling back to the
// favorite's own updated_at when its history is gone); then the rest of the
// history by how often it was logged in the last 90 days, breaking ties by
// last use. Capped at 50 rows — beyond that the person searches instead.
//
// The group_key expression here is SQL for the same rule groupKeyFor applies
// in Go, and is written to match migration 017's translate() call
// character-for-character (see normalizeSearchText's comment) so a food
// logged with an accented name groups identically either way.
const historyQuery = `
WITH logs_with_key AS (
	SELECT food_item_id, food_name, quantity_g, meal_type, calories, protein_g, carbs_g, fat_g, date, created_at,
		CASE WHEN food_item_id IS NOT NULL THEN 'item:' || food_item_id::text
		     ELSE 'name:' || lower(translate(trim(food_name),
		            'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
		            'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
		END AS group_key
	FROM food_logs
	WHERE user_id = $1
),
history AS (
	SELECT DISTINCT ON (group_key)
		group_key, food_item_id, food_name, quantity_g, meal_type, calories, protein_g, carbs_g, fat_g,
		created_at AS last_logged_at,
		COUNT(*) FILTER (WHERE date >= NOW() - INTERVAL '90 days') OVER (PARTITION BY group_key) AS times_logged
	FROM logs_with_key
	ORDER BY group_key, created_at DESC
),
combined AS (
	SELECT h.group_key, h.food_item_id, h.food_name, h.quantity_g, h.meal_type,
	       h.calories, h.protein_g, h.carbs_g, h.fat_g,
	       h.times_logged, h.last_logged_at, f.id AS favorite_id, f.updated_at AS favorite_updated_at
	FROM history h
	LEFT JOIN nutrition_favorites f ON f.user_id = $1 AND f.group_key = h.group_key
	UNION ALL
	SELECT f.group_key, f.food_item_id, f.food_name, f.quantity_g, f.meal_type,
	       f.calories, f.protein_g, f.carbs_g, f.fat_g,
	       0 AS times_logged, NULL::timestamptz AS last_logged_at, f.id AS favorite_id, f.updated_at AS favorite_updated_at
	FROM nutrition_favorites f
	WHERE f.user_id = $1 AND NOT EXISTS (SELECT 1 FROM history h WHERE h.group_key = f.group_key)
)
SELECT group_key, food_item_id, food_name, quantity_g, meal_type, calories, protein_g, carbs_g, fat_g,
       times_logged, last_logged_at, favorite_id
FROM combined
ORDER BY
	(favorite_id IS NOT NULL) DESC,
	CASE WHEN favorite_id IS NOT NULL THEN COALESCE(last_logged_at, favorite_updated_at) END DESC NULLS LAST,
	CASE WHEN favorite_id IS NULL THEN times_logged END DESC NULLS LAST,
	last_logged_at DESC NULLS LAST
LIMIT 50`

// GetLogHistory answers the "+ Log" screen's default view (nothing typed
// yet): what this person has actually eaten before, favorites pinned to the
// top. Cacheable offline like any other GET — see NON_CACHEABLE_GET_PATHS'
// comment for why this one is deliberately not on that list.
func (h *NutritionHandler) GetLogHistory(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(), historyQuery, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch log history"})
		return
	}
	defer rows.Close()

	entries := []models.FoodLogHistoryEntry{}
	for rows.Next() {
		var e models.FoodLogHistoryEntry
		if err := rows.Scan(&e.GroupKey, &e.FoodItemID, &e.FoodName, &e.QuantityG, &e.MealType,
			&e.Calories, &e.ProteinG, &e.CarbsG, &e.FatG, &e.TimesLogged, &e.LastLoggedAt, &e.FavoriteID); err != nil {
			continue
		}
		entries = append(entries, e)
	}

	writeJSON(w, http.StatusOK, entries)
}

// CreateFavorite is an upsert on (user_id, group_key): starring an
// already-favorited food just overwrites the snapshot with the current
// values instead of erroring or duplicating.
func (h *NutritionHandler) CreateFavorite(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req models.UpsertNutritionFavoriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	groupKey := strings.TrimSpace(req.GroupKey)
	foodName := strings.TrimSpace(req.FoodName)
	if groupKey == "" || foodName == "" || req.QuantityG <= 0 || !validMealTypes[req.MealType] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "group_key, food_name, quantity_g e meal_type são obrigatórios"})
		return
	}
	// Defense in depth: the client is trusted to send the same group_key it
	// displayed the row under, but a mismatch here would silently split one
	// food into two favorites, so it is recomputed and compared rather than
	// taken at face value.
	if expected := groupKeyFor(req.FoodItemID, foodName); groupKey != expected {
		groupKey = expected
	}

	var fav models.NutritionFavorite
	err := h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO nutrition_favorites (user_id, group_key, food_item_id, food_name, quantity_g, meal_type, calories, protein_g, carbs_g, fat_g)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 ON CONFLICT (user_id, group_key) DO UPDATE SET
		   food_item_id = EXCLUDED.food_item_id, food_name = EXCLUDED.food_name, quantity_g = EXCLUDED.quantity_g,
		   meal_type = EXCLUDED.meal_type, calories = EXCLUDED.calories, protein_g = EXCLUDED.protein_g,
		   carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g, updated_at = NOW()
		 RETURNING id, user_id, group_key, food_item_id, food_name, quantity_g, meal_type, calories, protein_g, carbs_g, fat_g, created_at, updated_at`,
		userID, groupKey, req.FoodItemID, foodName, req.QuantityG, req.MealType,
		req.Calories, req.ProteinG, req.CarbsG, req.FatG,
	).Scan(&fav.ID, &fav.UserID, &fav.GroupKey, &fav.FoodItemID, &fav.FoodName, &fav.QuantityG, &fav.MealType,
		&fav.Calories, &fav.ProteinG, &fav.CarbsG, &fav.FatG, &fav.CreatedAt, &fav.UpdatedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save favorite"})
		return
	}

	writeJSON(w, http.StatusCreated, fav)
}

func (h *NutritionHandler) DeleteFavorite(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid favorite id"})
		return
	}
	tag, err := h.db.Pool.Exec(r.Context(), `DELETE FROM nutrition_favorites WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete favorite"})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "favorite not found"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
