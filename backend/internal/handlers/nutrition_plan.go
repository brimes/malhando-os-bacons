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

func (h *NutritionHandler) planAssistantFor(ctx context.Context, userID int64) services.NutritionPlanAssistant {
	return services.NewNutritionPlanAssistant(h.resolver.For(ctx, userID))
}

func (h *NutritionHandler) ListPlans(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, user_id, name, calories_target, protein_target, carbs_target, fat_target,
		        rationale, creation_method, training_plan_id, active, created_at
		 FROM nutrition_plans WHERE user_id = $1 ORDER BY active DESC, id DESC`,
		userID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch plans"})
		return
	}
	plans := []models.NutritionPlan{}
	for rows.Next() {
		var p models.NutritionPlan
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.CaloriesTarget, &p.ProteinTarget, &p.CarbsTarget,
			&p.FatTarget, &p.Rationale, &p.CreationMethod, &p.TrainingPlanID, &p.Active, &p.CreatedAt); err != nil {
			continue
		}
		plans = append(plans, p)
	}
	rows.Close()

	// Only the active plan's menu is loaded: it is the only one the app shows
	// in full, and the list would otherwise pay for meals nobody is viewing.
	for i := range plans {
		if plans[i].Active {
			meals, err := h.loadPlanMeals(r.Context(), plans[i].ID)
			if err == nil {
				plans[i].Meals = meals
			}
		}
	}

	writeJSON(w, http.StatusOK, plans)
}

func (h *NutritionHandler) CreatePlan(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req models.ManualNutritionPlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.CaloriesTarget <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and calories_target are required"})
		return
	}

	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "transaction error"})
		return
	}
	defer tx.Rollback(r.Context())

	if _, err := tx.Exec(r.Context(), `UPDATE nutrition_plans SET active = false WHERE user_id = $1`, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update plans"})
		return
	}

	var plan models.NutritionPlan
	err = tx.QueryRow(r.Context(),
		`INSERT INTO nutrition_plans (user_id, name, calories_target, protein_target, carbs_target, fat_target, creation_method, active)
		 VALUES ($1, $2, $3, $4, $5, $6, 'manual', true)
		 RETURNING id, user_id, name, calories_target, protein_target, carbs_target, fat_target, rationale, creation_method, training_plan_id, active, created_at`,
		userID, req.Name, req.CaloriesTarget, req.ProteinTarget, req.CarbsTarget, req.FatTarget,
	).Scan(&plan.ID, &plan.UserID, &plan.Name, &plan.CaloriesTarget, &plan.ProteinTarget, &plan.CarbsTarget,
		&plan.FatTarget, &plan.Rationale, &plan.CreationMethod, &plan.TrainingPlanID, &plan.Active, &plan.CreatedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create plan"})
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "commit error"})
		return
	}

	writeJSON(w, http.StatusCreated, plan)
}

// CreateAutomatic enqueues generation of a full plan (targets + menu) and
// returns immediately: the assistant routinely takes minutes, far more than a
// request can be held open before the proxy's WriteTimeout turns it into a 500.
func (h *NutritionHandler) CreateAutomatic(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.AutomaticNutritionPlanRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	energy, daysPerWeek, err := h.loadEnergyProfile(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "complete seu perfil antes de gerar um plano nutricional"})
		return
	}
	userContext, err := buildNutritionContext(r.Context(), h.db, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare nutrition context"})
		return
	}

	var job models.NutritionPlanJob
	err = h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO nutrition_plan_jobs (user_id, kind, status) VALUES ($1,'generate','pending')
		 RETURNING id, kind, status, plan_id, error, created_at`, userID,
	).Scan(&job.ID, &job.Kind, &job.Status, &job.PlanID, &job.Error, &job.CreatedAt)
	if err != nil {
		slog.Error("failed to create nutrition plan job", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to start plan generation"})
		return
	}
	go h.runAutomaticNutrition(job.ID, userID, userContext, energy, daysPerWeek, req)
	writeJSON(w, http.StatusAccepted, job)
}

func (h *NutritionHandler) runAutomaticNutrition(jobID, userID int64, userContext string, energy services.EnergyProfile, daysPerWeek int, req models.AutomaticNutritionPlanRequest) {
	ctx, cancel := context.WithTimeout(context.Background(), automaticPlanTimeout)
	defer cancel()

	fail := func(message string, err error) {
		slog.Error(message, "user_id", userID, "job_id", jobID, "error", err)
		if _, updateErr := h.db.Pool.Exec(context.Background(),
			`UPDATE nutrition_plan_jobs SET status='failed', error=$2, updated_at=NOW() WHERE id=$1`,
			jobID, message); updateErr != nil {
			slog.Error("failed to mark nutrition plan job as failed", "job_id", jobID, "error", updateErr)
		}
	}

	input, err := h.planAssistantFor(ctx, userID).Generate(ctx, userContext, energy, daysPerWeek, req)
	if err != nil {
		fail("the nutrition assistant is temporarily unavailable", err)
		return
	}
	plan, err := h.persistPlan(ctx, userID, *input, "automatic")
	if err != nil {
		fail("failed to save generated nutrition plan", err)
		return
	}
	if _, err := h.db.Pool.Exec(context.Background(),
		`UPDATE nutrition_plan_jobs SET status='done', plan_id=$2, updated_at=NOW() WHERE id=$1`,
		jobID, plan.ID); err != nil {
		slog.Error("failed to mark nutrition plan job as done", "job_id", jobID, "error", err)
	}
}

func (h *NutritionHandler) GetJob(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid job id"})
		return
	}
	var job models.NutritionPlanJob
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT id, kind, status, plan_id, error, created_at FROM nutrition_plan_jobs
		 WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&job.ID, &job.Kind, &job.Status, &job.PlanID, &job.Error, &job.CreatedAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "job not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load job"})
		return
	}
	writeJSON(w, http.StatusOK, job)
}

// Adjust rewrites the menu from a free-text instruction, reconciling meals and
// items in place the same way training_plan_adjust.go reconciles days and
// exercises — though here the reason is weaker (no history references a meal
// item), the pattern stays consistent with its sibling feature.
func (h *NutritionHandler) Adjust(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	planID, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid plan id"})
		return
	}
	var req struct {
		Instructions string `json:"instructions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.Instructions = strings.TrimSpace(req.Instructions)
	if req.Instructions == "" || len(req.Instructions) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "descreva o ajuste em até 2000 caracteres"})
		return
	}

	current, err := h.loadNutritionPlanInput(r.Context(), planID, userID)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "nutrition plan not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load nutrition plan"})
		return
	}
	energy, daysPerWeek, err := h.loadEnergyProfile(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "complete seu perfil antes de ajustar o plano"})
		return
	}
	userContext, err := buildNutritionContext(r.Context(), h.db, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare nutrition context"})
		return
	}

	var job models.NutritionPlanJob
	err = h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO nutrition_plan_jobs (user_id, kind, status, plan_id) VALUES ($1,'adjust','pending',$2)
		 RETURNING id, kind, status, plan_id, error, created_at`, userID, planID,
	).Scan(&job.ID, &job.Kind, &job.Status, &job.PlanID, &job.Error, &job.CreatedAt)
	if err != nil {
		slog.Error("failed to create nutrition adjust job", "user_id", userID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to start adjustment"})
		return
	}
	go h.runAdjustNutrition(job.ID, userID, planID, userContext, energy, daysPerWeek, *current, req.Instructions)
	writeJSON(w, http.StatusAccepted, job)
}

func (h *NutritionHandler) runAdjustNutrition(jobID, userID, planID int64, userContext string, energy services.EnergyProfile, daysPerWeek int, current models.NutritionPlanInput, instructions string) {
	ctx, cancel := context.WithTimeout(context.Background(), automaticPlanTimeout)
	defer cancel()

	fail := func(message string, err error) {
		slog.Error(message, "user_id", userID, "job_id", jobID, "error", err)
		if _, updateErr := h.db.Pool.Exec(context.Background(),
			`UPDATE nutrition_plan_jobs SET status='failed', error=$2, updated_at=NOW() WHERE id=$1`,
			jobID, message); updateErr != nil {
			slog.Error("failed to mark nutrition adjust job as failed", "job_id", jobID, "error", updateErr)
		}
	}

	adjusted, err := h.planAssistantFor(ctx, userID).Adjust(ctx, userContext, energy, daysPerWeek, current, instructions)
	if err != nil {
		fail("the nutrition assistant is temporarily unavailable", err)
		return
	}
	if err := h.applyNutritionAdjustment(ctx, planID, *adjusted); err != nil {
		fail("failed to save the adjusted plan", err)
		return
	}
	if _, err := h.db.Pool.Exec(context.Background(),
		`UPDATE nutrition_plan_jobs SET status='done', plan_id=$2, updated_at=NOW() WHERE id=$1`,
		jobID, planID); err != nil {
		slog.Error("failed to mark nutrition adjust job as done", "job_id", jobID, "error", err)
	}
}

// Activate reactivates a past plan instead of forcing a new one to be typed
// or generated from scratch.
func (h *NutritionHandler) Activate(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseWorkoutIDFromSessionPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid plan id"})
		return
	}
	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "transaction error"})
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `UPDATE nutrition_plans SET active=false WHERE user_id=$1`, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update plans"})
		return
	}
	tag, err := tx.Exec(r.Context(), `UPDATE nutrition_plans SET active=true, updated_at=NOW() WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to activate plan"})
		return
	}
	if tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "nutrition plan not found"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "commit error"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// loadEnergyProfile reads what the calorie math needs, failing loudly when
// onboarding has not been completed rather than silently generating a plan
// against a fabricated profile.
func (h *NutritionHandler) loadEnergyProfile(ctx context.Context, userID int64) (services.EnergyProfile, int, error) {
	var birthDate time.Time
	var height, weight float64
	var sex *string
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT birth_date, height_cm, current_weight_kg, biological_sex FROM user_profiles WHERE user_id=$1`, userID,
	).Scan(&birthDate, &height, &weight, &sex); err != nil {
		return services.EnergyProfile{}, 0, err
	}
	sexValue := ""
	if sex != nil {
		sexValue = *sex
	}
	energy := services.EnergyProfile{
		WeightKg:      weight,
		HeightCm:      height,
		AgeYears:      calculateAge(birthDate, time.Now()),
		BiologicalSex: sexValue,
	}
	var daysPerWeek int
	_ = h.db.Pool.QueryRow(ctx,
		`SELECT days_per_week FROM training_plans WHERE user_id=$1 AND active=true AND kind='regular' LIMIT 1`, userID,
	).Scan(&daysPerWeek)
	return energy, daysPerWeek, nil
}

// persistPlan writes a freshly generated (or manually assembled) plan and its
// menu, deactivating whatever was active before.
func (h *NutritionHandler) persistPlan(ctx context.Context, userID int64, input models.NutritionPlanInput, method string) (*models.NutritionPlan, error) {
	tx, err := h.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `UPDATE nutrition_plans SET active=false WHERE user_id=$1`, userID); err != nil {
		return nil, err
	}

	var trainingPlanID *int64
	_ = tx.QueryRow(ctx, `SELECT id FROM training_plans WHERE user_id=$1 AND active=true AND kind='regular' LIMIT 1`, userID).Scan(&trainingPlanID)

	var plan models.NutritionPlan
	if err := tx.QueryRow(ctx,
		`INSERT INTO nutrition_plans (user_id, name, calories_target, protein_target, carbs_target, fat_target, rationale, creation_method, training_plan_id, active)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
		 RETURNING id, user_id, name, calories_target, protein_target, carbs_target, fat_target, rationale, creation_method, training_plan_id, active, created_at`,
		userID, input.Name, input.CaloriesTarget, input.ProteinTarget, input.CarbsTarget, input.FatTarget,
		input.Rationale, method, trainingPlanID,
	).Scan(&plan.ID, &plan.UserID, &plan.Name, &plan.CaloriesTarget, &plan.ProteinTarget, &plan.CarbsTarget,
		&plan.FatTarget, &plan.Rationale, &plan.CreationMethod, &plan.TrainingPlanID, &plan.Active, &plan.CreatedAt); err != nil {
		return nil, err
	}

	if err := insertPlanMeals(ctx, tx, plan.ID, input.Meals); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &plan, nil
}

func insertPlanMeals(ctx context.Context, tx pgx.Tx, planID int64, meals []models.NutritionPlanMealInput) error {
	for index, meal := range meals {
		var mealID int64
		if err := tx.QueryRow(ctx,
			`INSERT INTO nutrition_plan_meals (plan_id, meal_order, meal_type, name, suggested_at, notes)
			 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
			planID, index+1, meal.MealType, strings.TrimSpace(meal.Name), meal.SuggestedAt, strings.TrimSpace(meal.Notes),
		).Scan(&mealID); err != nil {
			return err
		}
		for itemIndex, item := range meal.Items {
			if _, err := tx.Exec(ctx,
				`INSERT INTO nutrition_plan_meal_items (meal_id, item_order, food_name, quantity_g, calories, protein_g, carbs_g, fat_g)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
				mealID, itemIndex+1, strings.TrimSpace(item.FoodName), item.QuantityG, item.Calories, item.ProteinG, item.CarbsG, item.FatG); err != nil {
				return err
			}
		}
	}
	return nil
}

func (h *NutritionHandler) loadPlanMeals(ctx context.Context, planID int64) ([]models.NutritionPlanMeal, error) {
	rows, err := h.db.Pool.Query(ctx,
		`SELECT id, meal_order, meal_type, name, suggested_at, notes FROM nutrition_plan_meals
		 WHERE plan_id=$1 ORDER BY meal_order`, planID)
	if err != nil {
		return nil, err
	}
	var meals []models.NutritionPlanMeal
	for rows.Next() {
		var m models.NutritionPlanMeal
		if err := rows.Scan(&m.ID, &m.MealOrder, &m.MealType, &m.Name, &m.SuggestedAt, &m.Notes); err != nil {
			continue
		}
		meals = append(meals, m)
	}
	rows.Close()

	for i := range meals {
		itemRows, err := h.db.Pool.Query(ctx,
			`SELECT id, item_order, food_item_id, food_name, quantity_g, calories, protein_g, carbs_g, fat_g
			 FROM nutrition_plan_meal_items WHERE meal_id=$1 ORDER BY item_order`, meals[i].ID)
		if err != nil {
			return nil, err
		}
		meals[i].Items = []models.NutritionPlanMealItem{}
		for itemRows.Next() {
			var item models.NutritionPlanMealItem
			if err := itemRows.Scan(&item.ID, &item.ItemOrder, &item.FoodItemID, &item.FoodName,
				&item.QuantityG, &item.Calories, &item.ProteinG, &item.CarbsG, &item.FatG); err == nil {
				meals[i].Items = append(meals[i].Items, item)
			}
		}
		itemRows.Close()
	}
	return meals, nil
}

func (h *NutritionHandler) loadNutritionPlanInput(ctx context.Context, planID, userID int64) (*models.NutritionPlanInput, error) {
	var input models.NutritionPlanInput
	if err := h.db.Pool.QueryRow(ctx,
		`SELECT name, calories_target, protein_target, carbs_target, fat_target, rationale
		 FROM nutrition_plans WHERE id=$1 AND user_id=$2`, planID, userID,
	).Scan(&input.Name, &input.CaloriesTarget, &input.ProteinTarget, &input.CarbsTarget, &input.FatTarget, &input.Rationale); err != nil {
		return nil, err
	}
	meals, err := h.loadPlanMeals(ctx, planID)
	if err != nil {
		return nil, err
	}
	for _, meal := range meals {
		mealInput := models.NutritionPlanMealInput{
			MealType: meal.MealType, Name: meal.Name, SuggestedAt: meal.SuggestedAt, Notes: meal.Notes,
		}
		for _, item := range meal.Items {
			mealInput.Items = append(mealInput.Items, models.NutritionPlanMealItemInput{
				FoodName: item.FoodName, QuantityG: item.QuantityG, Calories: item.Calories,
				ProteinG: item.ProteinG, CarbsG: item.CarbsG, FatG: item.FatG,
			})
		}
		input.Meals = append(input.Meals, mealInput)
	}
	return &input, nil
}

// applyNutritionAdjustment reconciles meals and items in place by position,
// the same shape as applyAdjustment/applyDayExercises in
// training_plan_adjust.go.
func (h *NutritionHandler) applyNutritionAdjustment(ctx context.Context, planID int64, plan models.NutritionPlanInput) error {
	tx, err := h.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`UPDATE nutrition_plans SET name=$2, calories_target=$3, protein_target=$4, carbs_target=$5, fat_target=$6, rationale=$7, updated_at=NOW()
		 WHERE id=$1`, planID, strings.TrimSpace(plan.Name), plan.CaloriesTarget, plan.ProteinTarget, plan.CarbsTarget, plan.FatTarget, strings.TrimSpace(plan.Rationale)); err != nil {
		return err
	}

	existingMeals := map[int]int64{}
	rows, err := tx.Query(ctx, `SELECT meal_order, id FROM nutrition_plan_meals WHERE plan_id=$1`, planID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var order int
		var id int64
		if err := rows.Scan(&order, &id); err == nil {
			existingMeals[order] = id
		}
	}
	rows.Close()

	for index, meal := range plan.Meals {
		order := index + 1
		if len(meal.Items) == 0 {
			return fmt.Errorf("refeição %d sem itens no plano ajustado", order)
		}
		mealID, exists := existingMeals[order]
		if exists {
			if _, err := tx.Exec(ctx,
				`UPDATE nutrition_plan_meals SET meal_type=$2, name=$3, suggested_at=$4, notes=$5 WHERE id=$1`,
				mealID, meal.MealType, strings.TrimSpace(meal.Name), meal.SuggestedAt, strings.TrimSpace(meal.Notes)); err != nil {
				return err
			}
			delete(existingMeals, order)
		} else {
			if err := tx.QueryRow(ctx,
				`INSERT INTO nutrition_plan_meals (plan_id, meal_order, meal_type, name, suggested_at, notes)
				 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
				planID, order, meal.MealType, strings.TrimSpace(meal.Name), meal.SuggestedAt, strings.TrimSpace(meal.Notes)).Scan(&mealID); err != nil {
				return err
			}
		}
		if err := applyMealItems(ctx, tx, mealID, meal.Items); err != nil {
			return err
		}
	}

	for _, id := range existingMeals {
		if _, err := tx.Exec(ctx, `DELETE FROM nutrition_plan_meals WHERE id=$1`, id); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func applyMealItems(ctx context.Context, tx pgx.Tx, mealID int64, items []models.NutritionPlanMealItemInput) error {
	current := map[int]int64{}
	rows, err := tx.Query(ctx, `SELECT item_order, id FROM nutrition_plan_meal_items WHERE meal_id=$1`, mealID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var order int
		var id int64
		if err := rows.Scan(&order, &id); err == nil {
			current[order] = id
		}
	}
	rows.Close()

	for index, item := range items {
		order := index + 1
		if strings.TrimSpace(item.FoodName) == "" || item.QuantityG <= 0 {
			return fmt.Errorf("item inválido na posição %d da refeição", order)
		}
		if id, ok := current[order]; ok {
			if _, err := tx.Exec(ctx,
				`UPDATE nutrition_plan_meal_items SET food_name=$2, quantity_g=$3, calories=$4, protein_g=$5, carbs_g=$6, fat_g=$7 WHERE id=$1`,
				id, strings.TrimSpace(item.FoodName), item.QuantityG, item.Calories, item.ProteinG, item.CarbsG, item.FatG); err != nil {
				return err
			}
			delete(current, order)
			continue
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO nutrition_plan_meal_items (meal_id, item_order, food_name, quantity_g, calories, protein_g, carbs_g, fat_g)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			mealID, order, strings.TrimSpace(item.FoodName), item.QuantityG, item.Calories, item.ProteinG, item.CarbsG, item.FatG); err != nil {
			return err
		}
	}
	for _, id := range current {
		if _, err := tx.Exec(ctx, `DELETE FROM nutrition_plan_meal_items WHERE id=$1`, id); err != nil {
			return err
		}
	}
	return nil
}

// SuggestRestOfDay computes what is left of today's targets from what was
// already logged and asks the coach to turn that into concrete suggestions.
// It runs synchronously: the answer is short and comfortably inside the
// server's WriteTimeout, unlike full plan generation.
func (h *NutritionHandler) SuggestRestOfDay(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())

	var plan models.NutritionPlan
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT calories_target, protein_target, carbs_target, fat_target FROM nutrition_plans WHERE user_id=$1 AND active=true`, userID,
	).Scan(&plan.CaloriesTarget, &plan.ProteinTarget, &plan.CarbsTarget, &plan.FatTarget)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "crie um plano nutricional antes de pedir uma sugestão"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load active plan"})
		return
	}

	var eaten models.NutritionSummary
	_ = h.db.Pool.QueryRow(r.Context(),
		`SELECT COALESCE(SUM(calories),0), COALESCE(SUM(protein_g),0), COALESCE(SUM(carbs_g),0), COALESCE(SUM(fat_g),0)
		 FROM food_logs WHERE user_id=$1 AND date::date = CURRENT_DATE`, userID,
	).Scan(&eaten.Calories, &eaten.ProteinG, &eaten.CarbsG, &eaten.FatG)

	suggestion := models.NutritionSuggestion{
		RemainingCalories: float64(plan.CaloriesTarget) - eaten.Calories,
		RemainingProteinG: plan.ProteinTarget - eaten.ProteinG,
		RemainingCarbsG:   plan.CarbsTarget - eaten.CarbsG,
		RemainingFatG:     plan.FatTarget - eaten.FatG,
	}

	userContext, err := buildNutritionContext(r.Context(), h.db, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to prepare nutrition context"})
		return
	}
	coachCtx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	suggestions, err := services.NewNutritionCoach(h.resolver.For(r.Context(), userID)).
		SuggestRestOfDay(coachCtx, userContext, suggestion.RemainingCalories, suggestion.RemainingProteinG, suggestion.RemainingCarbsG, suggestion.RemainingFatG)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "o assistente está indisponível no momento; tente de novo em instantes"})
		return
	}
	suggestion.Suggestions = suggestions
	writeJSON(w, http.StatusOK, suggestion)
}
