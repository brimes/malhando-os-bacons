package routes

import (
	"net/http"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/handlers"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/services"
)

// Setup wires the routes. The generator resolver, rather than a ready-made
// assistant, is what gets injected: which credentials each call runs on is only
// known once the user is.
func Setup(database *db.DB, resolver services.GeneratorResolver, jwtSecret, googleClientID, allowedOrigins string) http.Handler {
	mux := http.NewServeMux()

	authHandler := handlers.NewAuthHandler(database, jwtSecret, googleClientID)
	workoutHandler := handlers.NewWorkoutHandler(database)
	sessionHandler := handlers.NewWorkoutSessionHandler(database)
	nutritionHandler := handlers.NewNutritionHandler(database)
	stepsHandler := handlers.NewStepsHandler(database)
	dashboardHandler := handlers.NewDashboardHandler(database)
	resultsHandler := handlers.NewResultsHandler(database)
	onboardingHandler := handlers.NewOnboardingHandler(database, resolver)
	trainingPlanHandler := handlers.NewTrainingPlanHandler(database, resolver)
	termsHandler := handlers.NewTermsHandler(database)
	llmSettingsHandler := handlers.NewLLMSettingsHandler(database)
	workoutChatHandler := handlers.NewWorkoutChatHandler(database, resolver)

	auth := middleware.AuthMiddleware(jwtSecret)

	// Auth routes (public)
	mux.HandleFunc("POST /api/auth/register", authHandler.Register)
	mux.HandleFunc("POST /api/auth/login", authHandler.Login)
	mux.HandleFunc("POST /api/auth/google", authHandler.GoogleLogin)
	mux.HandleFunc("GET /api/auth/me", chain(authHandler.Me, auth))

	// Onboarding routes
	mux.HandleFunc("GET /api/onboarding", chain(onboardingHandler.Get, auth))
	mux.HandleFunc("PUT /api/onboarding/profile", chain(onboardingHandler.SaveProfile, auth))
	mux.HandleFunc("POST /api/onboarding/objective/messages", chain(onboardingHandler.SendObjectiveMessage, auth))
	mux.HandleFunc("POST /api/onboarding/objective/reset", chain(onboardingHandler.ResetObjective, auth))
	mux.HandleFunc("GET /api/onboarding/fitness-assessments", chain(onboardingHandler.ListFitnessAssessments, auth))
	mux.HandleFunc("POST /api/onboarding/fitness-assessments", chain(onboardingHandler.SaveFitnessAssessment, auth))

	// Workout routes
	mux.HandleFunc("GET /api/workouts", chain(workoutHandler.List, auth))
	mux.HandleFunc("POST /api/workouts", chain(workoutHandler.Create, auth))
	mux.HandleFunc("GET /api/workouts/stats", chain(workoutHandler.Stats, auth))
	mux.HandleFunc("GET /api/workouts/calendar", chain(workoutHandler.Calendar, auth))
	mux.HandleFunc("GET /api/workouts/{id}", chain(workoutHandler.Get, auth))
	mux.HandleFunc("PUT /api/workouts/{id}", chain(workoutHandler.Update, auth))
	mux.HandleFunc("DELETE /api/workouts/{id}", chain(workoutHandler.Delete, auth))

	// Guided workout session
	mux.HandleFunc("POST /api/workouts/start", chain(sessionHandler.Start, auth))
	mux.HandleFunc("GET /api/workouts/active", chain(sessionHandler.Active, auth))
	mux.HandleFunc("POST /api/workouts/{id}/sets", chain(sessionHandler.CompleteSet, auth))
	mux.HandleFunc("DELETE /api/workouts/{id}/sets/{setId}", chain(sessionHandler.DeleteSet, auth))
	mux.HandleFunc("POST /api/workouts/{id}/finish", chain(sessionHandler.Finish, auth))
	mux.HandleFunc("POST /api/workouts/{id}/complete", chain(sessionHandler.Complete, auth))
	mux.HandleFunc("POST /api/workouts/{id}/progress", chain(sessionHandler.Progress, auth))
	mux.HandleFunc("POST /api/workouts/{id}/cancel", chain(sessionHandler.Cancel, auth))

	// Dúvidas durante o treino
	mux.HandleFunc("GET /api/workouts/{id}/chat", chain(workoutChatHandler.List, auth))
	mux.HandleFunc("POST /api/workouts/{id}/chat", chain(workoutChatHandler.Send, auth))

	// Training session settings
	mux.HandleFunc("GET /api/settings", chain(sessionHandler.GetSettings, auth))
	mux.HandleFunc("PUT /api/settings", chain(sessionHandler.UpdateSettings, auth))

	// Termo de isenção de responsabilidade
	mux.HandleFunc("GET /api/terms", chain(termsHandler.Get, auth))
	mux.HandleFunc("POST /api/terms/accept", chain(termsHandler.Accept, auth))

	// Configurações de LLM e assinatura (mock)
	mux.HandleFunc("GET /api/llm-settings", chain(llmSettingsHandler.Get, auth))
	mux.HandleFunc("PUT /api/llm-settings", chain(llmSettingsHandler.Update, auth))
	mux.HandleFunc("POST /api/subscription/mock", chain(llmSettingsHandler.MockSubscription, auth))

	// Training plan routes
	mux.HandleFunc("GET /api/training-plans", chain(trainingPlanHandler.List, auth))
	mux.HandleFunc("POST /api/training-plans/manual", chain(trainingPlanHandler.CreateManual, auth))
	mux.HandleFunc("POST /api/training-plans/automatic", chain(trainingPlanHandler.CreateAutomatic, auth))
	mux.HandleFunc("GET /api/training-plans/jobs/{id}", chain(trainingPlanHandler.GetJob, auth))
	mux.HandleFunc("GET /api/training-plans/{id}", chain(trainingPlanHandler.Get, auth))
	mux.HandleFunc("POST /api/training-plans/{id}/adjust", chain(trainingPlanHandler.Adjust, auth))
	mux.HandleFunc("DELETE /api/training-plans/{id}", chain(trainingPlanHandler.Delete, auth))

	// Nutrition routes
	mux.HandleFunc("GET /api/nutrition/plans", chain(nutritionHandler.ListPlans, auth))
	mux.HandleFunc("POST /api/nutrition/plans", chain(nutritionHandler.CreatePlan, auth))
	mux.HandleFunc("GET /api/nutrition/logs", chain(nutritionHandler.GetLogs, auth))
	mux.HandleFunc("POST /api/nutrition/logs", chain(nutritionHandler.CreateLog, auth))
	mux.HandleFunc("GET /api/nutrition/calendar", chain(nutritionHandler.Calendar, auth))
	mux.HandleFunc("GET /api/nutrition/foods/search", chain(nutritionHandler.SearchFoods, auth))

	// Steps routes
	mux.HandleFunc("GET /api/steps", chain(stepsHandler.GetToday, auth))
	mux.HandleFunc("POST /api/steps/sync", chain(stepsHandler.Sync, auth))

	// Results (histórico de medições)
	mux.HandleFunc("GET /api/results", chain(resultsHandler.List, auth))
	mux.HandleFunc("POST /api/results", chain(resultsHandler.Save, auth))
	mux.HandleFunc("DELETE /api/results/{id}", chain(resultsHandler.Delete, auth))

	// Dashboard
	mux.HandleFunc("GET /api/dashboard", chain(dashboardHandler.Get, auth))

	// Health check
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	corsMiddleware := middleware.CORSMiddleware(allowedOrigins)
	return corsMiddleware(mux)
}

func chain(h http.HandlerFunc, middlewares ...func(http.Handler) http.Handler) http.HandlerFunc {
	var handler http.Handler = h
	for i := len(middlewares) - 1; i >= 0; i-- {
		handler = middlewares[i](handler)
	}
	return handler.ServeHTTP
}
