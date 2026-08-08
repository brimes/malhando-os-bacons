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
// videoSigner pode ser nil: sem credencial configurada os endpoints de vídeo
// respondem 503 e o resto da API funciona normalmente.
func Setup(database *db.DB, resolver services.GeneratorResolver, videoSigner *services.GCSSigner, jwtSecret, googleClientID, allowedOrigins, photoDir string) http.Handler {
	mux := http.NewServeMux()

	authHandler := handlers.NewAuthHandler(database, jwtSecret, googleClientID)
	workoutHandler := handlers.NewWorkoutHandler(database)
	sessionHandler := handlers.NewWorkoutSessionHandler(database)
	nutritionHandler := handlers.NewNutritionHandler(database, resolver, photoDir)
	stepsHandler := handlers.NewStepsHandler(database)
	dashboardHandler := handlers.NewDashboardHandler(database)
	resultsHandler := handlers.NewResultsHandler(database)
	legalHandler := handlers.NewLegalHandler()
	onboardingHandler := handlers.NewOnboardingHandler(database, resolver)
	trainingPlanHandler := handlers.NewTrainingPlanHandler(database, resolver)
	termsHandler := handlers.NewTermsHandler(database)
	llmSettingsHandler := handlers.NewLLMSettingsHandler(database)
	workoutChatHandler := handlers.NewWorkoutChatHandler(database, resolver)
	exerciseVideoHandler := handlers.NewExerciseVideoHandler(database, videoSigner)
	// Recebe os dois handlers de plano porque aplicar a avaliação reusa a
	// reconciliação in-place deles — é ela que preserva o histórico treinado.
	progressReviewHandler := handlers.NewProgressReviewHandler(database, resolver, trainingPlanHandler, nutritionHandler)

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
	mux.HandleFunc("GET /api/training-plans/compensation", chain(trainingPlanHandler.GetCompensation, auth))
	mux.HandleFunc("GET /api/training-plans/{id}", chain(trainingPlanHandler.Get, auth))
	mux.HandleFunc("POST /api/training-plans/{id}/adjust", chain(trainingPlanHandler.Adjust, auth))
	mux.HandleFunc("DELETE /api/training-plans/{id}", chain(trainingPlanHandler.Delete, auth))

	// Vídeos demonstrativos de exercício. Autenticados: quem paga o egress do
	// bucket é o dono do projeto, e um endpoint aberto que devolve URL assinada
	// é um proxy de download para qualquer um.
	mux.HandleFunc("GET /api/exercise-videos/catalog", chain(exerciseVideoHandler.Catalog, auth))
	mux.HandleFunc("POST /api/exercise-videos/urls", chain(exerciseVideoHandler.SignURLs, auth))

	// Nutrition routes
	mux.HandleFunc("GET /api/nutrition/plans", chain(nutritionHandler.ListPlans, auth))
	mux.HandleFunc("POST /api/nutrition/plans", chain(nutritionHandler.CreatePlan, auth))
	mux.HandleFunc("POST /api/nutrition/plans/automatic", chain(nutritionHandler.CreateAutomatic, auth))
	mux.HandleFunc("GET /api/nutrition/plans/jobs/{id}", chain(nutritionHandler.GetJob, auth))
	mux.HandleFunc("POST /api/nutrition/plans/{id}/adjust", chain(nutritionHandler.Adjust, auth))
	mux.HandleFunc("PUT /api/nutrition/plans/{id}/activate", chain(nutritionHandler.Activate, auth))
	mux.HandleFunc("GET /api/nutrition/logs", chain(nutritionHandler.GetLogs, auth))
	mux.HandleFunc("POST /api/nutrition/logs", chain(nutritionHandler.CreateLog, auth))
	// No GET /api/nutrition/logs/{id} exists, so this does not collide in the
	// Go 1.22 mux.
	mux.HandleFunc("GET /api/nutrition/logs/history", chain(nutritionHandler.GetLogHistory, auth))
	mux.HandleFunc("PUT /api/nutrition/logs/{id}", chain(nutritionHandler.UpdateLog, auth))
	mux.HandleFunc("DELETE /api/nutrition/logs/{id}", chain(nutritionHandler.DeleteLog, auth))
	mux.HandleFunc("POST /api/nutrition/favorites", chain(nutritionHandler.CreateFavorite, auth))
	mux.HandleFunc("DELETE /api/nutrition/favorites/{id}", chain(nutritionHandler.DeleteFavorite, auth))
	mux.HandleFunc("GET /api/nutrition/calendar", chain(nutritionHandler.Calendar, auth))
	mux.HandleFunc("GET /api/nutrition/foods/search", chain(nutritionHandler.SearchFoods, auth))
	mux.HandleFunc("GET /api/nutrition/foods", chain(nutritionHandler.ListPersonalFoods, auth))
	mux.HandleFunc("POST /api/nutrition/foods", chain(nutritionHandler.CreatePersonalFood, auth))
	mux.HandleFunc("PUT /api/nutrition/foods/{id}", chain(nutritionHandler.UpdatePersonalFood, auth))
	mux.HandleFunc("DELETE /api/nutrition/foods/{id}", chain(nutritionHandler.DeletePersonalFood, auth))
	mux.HandleFunc("GET /api/nutrition/suggestion", chain(nutritionHandler.SuggestRestOfDay, auth))
	mux.HandleFunc("POST /api/nutrition/photos", chain(nutritionHandler.UploadPhoto, auth))
	mux.HandleFunc("GET /api/nutrition/photos/{id}", chain(nutritionHandler.ServePhoto, auth))
	mux.HandleFunc("GET /api/nutrition/cheat-day", chain(nutritionHandler.GetCheatDay, auth))
	mux.HandleFunc("POST /api/nutrition/cheat-day/messages", chain(nutritionHandler.SendCheatDayMessage, auth))
	mux.HandleFunc("POST /api/nutrition/cheat-day/{id}/accept", chain(nutritionHandler.AcceptCheatDay, auth))
	mux.HandleFunc("POST /api/nutrition/cheat-day/{id}/discard", chain(nutritionHandler.DiscardCheatDay, auth))

	// Steps routes
	mux.HandleFunc("GET /api/steps", chain(stepsHandler.GetToday, auth))
	mux.HandleFunc("POST /api/steps/sync", chain(stepsHandler.Sync, auth))

	// Results (histórico de medições)
	mux.HandleFunc("GET /api/results", chain(resultsHandler.List, auth))
	mux.HandleFunc("POST /api/results", chain(resultsHandler.Save, auth))
	mux.HandleFunc("DELETE /api/results/{id}", chain(resultsHandler.Delete, auth))

	// Avaliação do resultado. `latest` é literal e tem precedência sobre
	// `{id}` no mux do Go 1.22, então as duas rotas convivem.
	mux.HandleFunc("POST /api/progress-reviews", chain(progressReviewHandler.Create, auth))
	mux.HandleFunc("GET /api/progress-reviews/latest", chain(progressReviewHandler.Latest, auth))
	mux.HandleFunc("GET /api/progress-reviews/{id}", chain(progressReviewHandler.Get, auth))
	mux.HandleFunc("POST /api/progress-reviews/{id}/apply", chain(progressReviewHandler.Apply, auth))
	mux.HandleFunc("POST /api/progress-reviews/{id}/discard", chain(progressReviewHandler.Discard, auth))
	mux.HandleFunc("GET /api/progress-reviews/{id}/chat", chain(progressReviewHandler.ChatList, auth))
	mux.HandleFunc("POST /api/progress-reviews/{id}/chat", chain(progressReviewHandler.ChatSend, auth))

	// Dashboard
	mux.HandleFunc("GET /api/dashboard", chain(dashboardHandler.Get, auth))

	// Política de privacidade: pública, sem autenticação. A Play exige uma URL
	// aberta, e o revisor da loja acessa sem conta.
	mux.HandleFunc("GET /privacidade", legalHandler.Privacy)
	mux.HandleFunc("GET /privacy", legalHandler.Privacy)

	// Health check. Used by k8s liveness/readiness probes — do not remove or
	// move behind auth.
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Same check, under /api: the frontend's connectivity probe needs it here
	// because the Vite dev proxy only forwards `/api/**`, and this is the one
	// endpoint it must reach with a token possibly expired or absent — no
	// auth, deliberately cheap.
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
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
