package handlers

import (
	"encoding/json"
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

type OnboardingHandler struct {
	db       *db.DB
	resolver services.GeneratorResolver
}

func NewOnboardingHandler(database *db.DB, resolver services.GeneratorResolver) *OnboardingHandler {
	return &OnboardingHandler{db: database, resolver: resolver}
}

func (h *OnboardingHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	state := models.OnboardingState{Messages: []models.OnboardingMessage{}}

	var profile models.UserProfile
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT birth_date, height_cm, current_weight_kg, biological_sex, injuries_or_limitations,
		 training_experience, adaptation_ends_at
		 FROM user_profiles WHERE user_id = $1`, userID,
	).Scan(&profile.BirthDate, &profile.HeightCM, &profile.CurrentWeightKG, &profile.BiologicalSex,
		&profile.InjuriesOrLimitations, &profile.TrainingExperience, &profile.AdaptationEndsAt)
	if err == nil {
		profile.Age = calculateAge(profile.BirthDate, time.Now())
		state.Profile = &profile
	} else if err != pgx.ErrNoRows {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load profile"})
		return
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT role, content, action, created_at FROM onboarding_messages
		 WHERE user_id = $1 ORDER BY id`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load onboarding messages"})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var message models.OnboardingMessage
		if err := rows.Scan(&message.Role, &message.Content, &message.Action, &message.CreatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load onboarding messages"})
			return
		}
		state.Messages = append(state.Messages, message)
	}

	var goal models.UserGoal
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT goal_type, target_weight_kg, target_body_fat_percentage, target_muscle_mass_kg,
		 target_six_minute_walk_meters, conditioning_focus, target_date, feasibility, feasibility_warning, summary
		 FROM user_goals WHERE user_id = $1`, userID,
	).Scan(&goal.GoalType, &goal.TargetWeightKG, &goal.TargetBodyFatPercentage, &goal.TargetMuscleMassKG,
		&goal.TargetSixMinuteWalkMeters, &goal.ConditioningFocus, &goal.TargetDate,
		&goal.Feasibility, &goal.FeasibilityWarning, &goal.Summary)
	if err == nil {
		state.Goal = &goal
	} else if err != pgx.ErrNoRows {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load goal"})
		return
	}

	assessment, err := h.loadLatestFitnessAssessment(r, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load fitness assessment"})
		return
	}
	state.FitnessAssessment = assessment

	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT onboarding_completed_at IS NOT NULL FROM users WHERE id = $1`, userID,
	).Scan(&state.Completed)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load onboarding status"})
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (h *OnboardingHandler) SaveProfile(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.SaveProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	birthDate, err := time.Parse("2006-01-02", req.BirthDate)
	now := time.Now()
	if err != nil || !birthDate.Before(now) || birthDate.Before(now.AddDate(-120, 0, 0)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid birth date"})
		return
	}
	if req.HeightCM < 50 || req.HeightCM > 260 || req.CurrentWeightKG < 20 || req.CurrentWeightKG > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "height or weight is outside the accepted range"})
		return
	}
	if req.BiologicalSex != nil && *req.BiologicalSex != "female" && *req.BiologicalSex != "male" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid biological sex"})
		return
	}
	if req.TrainingExperience != "beginner" && req.TrainingExperience != "experienced" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid training experience"})
		return
	}
	if req.InjuriesOrLimitations != nil {
		value := strings.TrimSpace(*req.InjuriesOrLimitations)
		if len(value) > 1000 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "injuries or limitations must have at most 1000 characters"})
			return
		}
		if value == "" {
			req.InjuriesOrLimitations = nil
		} else {
			req.InjuriesOrLimitations = &value
		}
	}

	_, err = h.db.Pool.Exec(r.Context(),
		`INSERT INTO user_profiles (user_id, birth_date, height_cm, current_weight_kg, biological_sex,
		 injuries_or_limitations, training_experience)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (user_id) DO UPDATE SET
		 birth_date = EXCLUDED.birth_date, height_cm = EXCLUDED.height_cm,
		 current_weight_kg = EXCLUDED.current_weight_kg, biological_sex = EXCLUDED.biological_sex,
		 injuries_or_limitations = EXCLUDED.injuries_or_limitations,
		 training_experience = EXCLUDED.training_experience,
		 updated_at = NOW()`,
		userID, birthDate, req.HeightCM, req.CurrentWeightKG, req.BiologicalSex,
		req.InjuriesOrLimitations, req.TrainingExperience)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save profile"})
		return
	}
	_, err = h.db.Pool.Exec(r.Context(),
		`UPDATE user_profiles p SET adaptation_ends_at = CASE
		 WHEN p.training_experience = 'beginner' THEN COALESCE(p.adaptation_ends_at, CURRENT_DATE + INTERVAL '1 month')
		 ELSE NULL END
		 FROM users u WHERE p.user_id = u.id AND p.user_id = $1 AND u.onboarding_completed_at IS NOT NULL`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update adaptation period"})
		return
	}
	var profile models.UserProfile
	err = h.db.Pool.QueryRow(r.Context(),
		`SELECT birth_date, height_cm, current_weight_kg, biological_sex, injuries_or_limitations,
		 training_experience, adaptation_ends_at FROM user_profiles WHERE user_id = $1`, userID,
	).Scan(&profile.BirthDate, &profile.HeightCM, &profile.CurrentWeightKG, &profile.BiologicalSex,
		&profile.InjuriesOrLimitations, &profile.TrainingExperience, &profile.AdaptationEndsAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load saved profile"})
		return
	}
	profile.Age = calculateAge(profile.BirthDate, now)
	writeJSON(w, http.StatusOK, profile)
}

func (h *OnboardingHandler) SendObjectiveMessage(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.ObjectiveMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" || len(req.Message) > 1000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "message must be between 1 and 1000 characters"})
		return
	}

	var profile models.UserProfile
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT birth_date, height_cm, current_weight_kg, biological_sex, injuries_or_limitations,
		 training_experience, adaptation_ends_at
		 FROM user_profiles WHERE user_id = $1`, userID,
	).Scan(&profile.BirthDate, &profile.HeightCM, &profile.CurrentWeightKG, &profile.BiologicalSex,
		&profile.InjuriesOrLimitations, &profile.TrainingExperience, &profile.AdaptationEndsAt)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "complete the profile first"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load profile"})
		return
	}
	profile.Age = calculateAge(profile.BirthDate, time.Now())

	messages, err := h.loadRecentMessages(r, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load conversation"})
		return
	}
	messages = append(messages, models.OnboardingMessage{Role: "user", Content: req.Message, CreatedAt: time.Now()})
	assessment, err := h.loadLatestFitnessAssessment(r, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load fitness assessment"})
		return
	}
	// The assistant runs on this user's own API key when they saved one.
	assistant := services.NewGoalAssistant(h.resolver.For(r.Context(), userID))
	result, err := assistant.Analyze(r.Context(), profile, assessment, messages)
	if err != nil {
		slog.Error("goal assistant failed", "user_id", userID, "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "the goal assistant is temporarily unavailable"})
		return
	}

	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save conversation"})
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(),
		`INSERT INTO onboarding_messages (user_id, role, content, action)
		 VALUES ($1, 'user', $2, NULL), ($1, 'assistant', $3, $4)`,
		userID, req.Message, result.Message, result.Action); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save conversation"})
		return
	}

	response := models.ObjectiveMessageResponse{
		Message:   models.OnboardingMessage{Role: "assistant", Content: result.Message, Action: result.Action, CreatedAt: time.Now()},
		Completed: result.Complete,
	}
	if result.Complete {
		targetDate, _ := time.Parse("2006-01-02", *result.TargetDate)
		goal := &models.UserGoal{
			GoalType: *result.GoalType, TargetWeightKG: result.TargetWeightKG,
			TargetBodyFatPercentage: result.TargetBodyFatPercentage, TargetMuscleMassKG: result.TargetMuscleMassKG,
			TargetSixMinuteWalkMeters: result.TargetSixMinuteWalkMeters, ConditioningFocus: result.ConditioningFocus,
			TargetDate: &targetDate, Feasibility: *result.Feasibility,
			FeasibilityWarning: result.FeasibilityWarning, Summary: *result.Summary,
		}
		if _, err = tx.Exec(r.Context(),
			`INSERT INTO user_goals (user_id, goal_type, target_weight_kg, target_body_fat_percentage,
			 target_muscle_mass_kg, target_six_minute_walk_meters, conditioning_focus, target_date,
			 feasibility, feasibility_warning, summary)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			 ON CONFLICT (user_id) DO UPDATE SET goal_type = EXCLUDED.goal_type,
			 target_weight_kg = EXCLUDED.target_weight_kg,
			 target_body_fat_percentage = EXCLUDED.target_body_fat_percentage,
			 target_muscle_mass_kg = EXCLUDED.target_muscle_mass_kg,
			 target_six_minute_walk_meters = EXCLUDED.target_six_minute_walk_meters,
			 conditioning_focus = EXCLUDED.conditioning_focus,
			 target_date = EXCLUDED.target_date,
			 feasibility = EXCLUDED.feasibility,
			 feasibility_warning = EXCLUDED.feasibility_warning,
			 summary = EXCLUDED.summary, updated_at = NOW()`,
			userID, goal.GoalType, goal.TargetWeightKG, goal.TargetBodyFatPercentage,
			goal.TargetMuscleMassKG, goal.TargetSixMinuteWalkMeters, goal.ConditioningFocus,
			goal.TargetDate, goal.Feasibility, goal.FeasibilityWarning, goal.Summary); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save goal"})
			return
		}
		if _, err = tx.Exec(r.Context(), `UPDATE users SET onboarding_completed_at = NOW() WHERE id = $1`, userID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to complete onboarding"})
			return
		}
		if _, err = tx.Exec(r.Context(),
			`UPDATE user_profiles SET adaptation_ends_at = CASE
			 WHEN training_experience = 'beginner' THEN COALESCE(adaptation_ends_at, CURRENT_DATE + INTERVAL '1 month')
			 ELSE NULL END WHERE user_id = $1`, userID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to set adaptation period"})
			return
		}
		response.Goal = goal
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save onboarding"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *OnboardingHandler) ResetObjective(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to reset objective"})
		return
	}
	defer tx.Rollback(r.Context())

	if _, err = tx.Exec(r.Context(), `DELETE FROM onboarding_messages WHERE user_id = $1`, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to reset objective"})
		return
	}
	if _, err = tx.Exec(r.Context(), `DELETE FROM user_goals WHERE user_id = $1`, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to reset objective"})
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE users SET onboarding_completed_at = NULL WHERE id = $1`, userID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to reset objective"})
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to reset objective"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"completed": false})
}

func (h *OnboardingHandler) SaveFitnessAssessment(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.SaveFitnessAssessmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.DistanceMeters < 50 || req.DistanceMeters > 2000 || req.PerceivedExertion < 1 || req.PerceivedExertion > 10 ||
		(req.AverageHeartRate != nil && (*req.AverageHeartRate < 30 || *req.AverageHeartRate > 240)) ||
		(req.PostHeartRate != nil && (*req.PostHeartRate < 30 || *req.PostHeartRate > 240)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid fitness assessment values"})
		return
	}
	var assessment models.FitnessAssessment
	err := h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO fitness_assessments (user_id, test_type, distance_meters, average_heart_rate, post_heart_rate, perceived_exertion)
		 VALUES ($1, 'six_minute_walk', $2, $3, $4, $5)
		 RETURNING distance_meters, average_heart_rate, post_heart_rate, perceived_exertion, performed_at`,
		userID, req.DistanceMeters, req.AverageHeartRate, req.PostHeartRate, req.PerceivedExertion,
	).Scan(&assessment.DistanceMeters, &assessment.AverageHeartRate, &assessment.PostHeartRate, &assessment.PerceivedExertion, &assessment.PerformedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save fitness assessment"})
		return
	}
	writeJSON(w, http.StatusCreated, assessment)
}

func (h *OnboardingHandler) ListFitnessAssessments(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT distance_meters, average_heart_rate, post_heart_rate, perceived_exertion, performed_at
		 FROM fitness_assessments WHERE user_id = $1 AND test_type = 'six_minute_walk'
		 ORDER BY performed_at DESC`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load fitness assessments"})
		return
	}
	defer rows.Close()
	assessments := []models.FitnessAssessment{}
	for rows.Next() {
		var assessment models.FitnessAssessment
		if err := rows.Scan(&assessment.DistanceMeters, &assessment.AverageHeartRate, &assessment.PostHeartRate,
			&assessment.PerceivedExertion, &assessment.PerformedAt); err != nil {
			continue
		}
		assessments = append(assessments, assessment)
	}
	writeJSON(w, http.StatusOK, assessments)
}

func (h *OnboardingHandler) loadRecentMessages(r *http.Request, userID int64) ([]models.OnboardingMessage, error) {
	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT role, content, action, created_at FROM (
		 SELECT id, role, content, action, created_at FROM onboarding_messages
		 WHERE user_id = $1 ORDER BY id DESC LIMIT 30
		) recent ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := []models.OnboardingMessage{}
	for rows.Next() {
		var message models.OnboardingMessage
		if err := rows.Scan(&message.Role, &message.Content, &message.Action, &message.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

func (h *OnboardingHandler) loadLatestFitnessAssessment(r *http.Request, userID int64) (*models.FitnessAssessment, error) {
	var assessment models.FitnessAssessment
	err := h.db.Pool.QueryRow(r.Context(),
		`SELECT distance_meters, average_heart_rate, post_heart_rate, perceived_exertion, performed_at
		 FROM fitness_assessments WHERE user_id = $1 AND test_type = 'six_minute_walk'
		 ORDER BY performed_at DESC LIMIT 1`, userID,
	).Scan(&assessment.DistanceMeters, &assessment.AverageHeartRate, &assessment.PostHeartRate, &assessment.PerceivedExertion, &assessment.PerformedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &assessment, nil
}

func calculateAge(birthDate, now time.Time) int {
	age := now.Year() - birthDate.Year()
	if now.Month() < birthDate.Month() || (now.Month() == birthDate.Month() && now.Day() < birthDate.Day()) {
		age--
	}
	return age
}
