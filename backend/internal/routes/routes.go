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

	authHandler := handlers.NewAuthHandler(database, jwtSecret, googleClientID, photoDir)
	workoutHandler := handlers.NewWorkoutHandler(database)
	sessionHandler := handlers.NewWorkoutSessionHandler(database, resolver)
	nutritionHandler := handlers.NewNutritionHandler(database, resolver, photoDir)
	stepsHandler := handlers.NewStepsHandler(database)
	dashboardHandler := handlers.NewDashboardHandler(database)
	resultsHandler := handlers.NewResultsHandler(database)
	legalHandler := handlers.NewLegalHandler()
	onboardingHandler := handlers.NewOnboardingHandler(database, resolver)
	trainingPlanHandler := handlers.NewTrainingPlanHandler(database, resolver)
	gymHandler := handlers.NewGymHandler(database)
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
	// Excluir a conta de dentro do app é exigência da Apple (5.1.1(v)) para
	// quem deixa criar conta. Apaga de verdade: cascata no banco e as fotos.
	mux.HandleFunc("DELETE /api/auth/me", chain(authHandler.DeleteAccount, auth))

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
	// Troca de exercício confirmada na tela — vinda da proposta do chat ou
	// aplicada diretamente. scope="session" só vale para este treino;
	// scope="plan" reconcilia training_plan_exercises no lugar.
	mux.HandleFunc("POST /api/workouts/{id}/substitutions", chain(sessionHandler.Substitute, auth))

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
	// Plano dinâmico: cria a configuração na hora (sem LLM), e cada dia nasce
	// sob demanda via dynamic-day — mesmo padrão de job/polling de automatic.
	mux.HandleFunc("POST /api/training-plans/dynamic", chain(trainingPlanHandler.CreateDynamic, auth))
	mux.HandleFunc("POST /api/training-plans/{id}/dynamic-day", chain(trainingPlanHandler.GenerateDynamicDay, auth))
	mux.HandleFunc("GET /api/training-plans/jobs/{id}", chain(trainingPlanHandler.GetJob, auth))
	mux.HandleFunc("GET /api/training-plans/compensation", chain(trainingPlanHandler.GetCompensation, auth))
	mux.HandleFunc("GET /api/training-plans/{id}", chain(trainingPlanHandler.Get, auth))
	mux.HandleFunc("POST /api/training-plans/{id}/adjust", chain(trainingPlanHandler.Adjust, auth))
	mux.HandleFunc("POST /api/training-plans/{id}/archive", chain(trainingPlanHandler.Archive, auth))
	mux.HandleFunc("POST /api/training-plans/{id}/unarchive", chain(trainingPlanHandler.Unarchive, auth))
	mux.HandleFunc("DELETE /api/training-plans/{id}", chain(trainingPlanHandler.Delete, auth))

	// Academias e aparelhos: escopam a geração de plano ao que a pessoa tem à
	// mão (ver gymEquipmentRule em training_plan_assistant.go).
	mux.HandleFunc("GET /api/gyms", chain(gymHandler.List, auth))
	mux.HandleFunc("POST /api/gyms", chain(gymHandler.Create, auth))
	mux.HandleFunc("GET /api/gyms/{id}", chain(gymHandler.Get, auth))
	mux.HandleFunc("PUT /api/gyms/{id}", chain(gymHandler.Update, auth))
	mux.HandleFunc("DELETE /api/gyms/{id}", chain(gymHandler.Delete, auth))

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
	// Modo IA da tela de registrar: conversa que vira registros. Não grava nada;
	// quem grava é o app, pelos endpoints de log, depois da conferência.
	mux.HandleFunc("POST /api/nutrition/logs/assistant", chain(nutritionHandler.LogAssistant, auth))
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

	// Página de suporte: pública pelo mesmo motivo. A App Store exige uma URL de
	// suporte por versão, e o revisor a abre sem conta.
	mux.HandleFunc("GET /suporte", legalHandler.Support)
	mux.HandleFunc("GET /support", legalHandler.Support)

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
