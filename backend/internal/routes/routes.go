package routes

import (
	"net/http"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/handlers"
	"github.com/mob/backend/internal/middleware"
)

func Setup(database *db.DB, jwtSecret, allowedOrigins string) http.Handler {
	mux := http.NewServeMux()

	authHandler := handlers.NewAuthHandler(database, jwtSecret)
	workoutHandler := handlers.NewWorkoutHandler(database)
	nutritionHandler := handlers.NewNutritionHandler(database)
	stepsHandler := handlers.NewStepsHandler(database)
	dashboardHandler := handlers.NewDashboardHandler(database)

	auth := middleware.AuthMiddleware(jwtSecret)

	// Auth routes (public)
	mux.HandleFunc("POST /api/auth/google", authHandler.GoogleLogin)
	mux.HandleFunc("GET /api/auth/me", chain(authHandler.Me, auth))

	// Workout routes
	mux.HandleFunc("GET /api/workouts", chain(workoutHandler.List, auth))
	mux.HandleFunc("POST /api/workouts", chain(workoutHandler.Create, auth))
	mux.HandleFunc("GET /api/workouts/stats", chain(workoutHandler.Stats, auth))
	mux.HandleFunc("GET /api/workouts/{id}", chain(workoutHandler.Get, auth))
	mux.HandleFunc("PUT /api/workouts/{id}", chain(workoutHandler.Update, auth))
	mux.HandleFunc("DELETE /api/workouts/{id}", chain(workoutHandler.Delete, auth))

	// Nutrition routes
	mux.HandleFunc("GET /api/nutrition/plans", chain(nutritionHandler.ListPlans, auth))
	mux.HandleFunc("POST /api/nutrition/plans", chain(nutritionHandler.CreatePlan, auth))
	mux.HandleFunc("GET /api/nutrition/logs", chain(nutritionHandler.GetLogs, auth))
	mux.HandleFunc("POST /api/nutrition/logs", chain(nutritionHandler.CreateLog, auth))
	mux.HandleFunc("GET /api/nutrition/foods/search", chain(nutritionHandler.SearchFoods, auth))

	// Steps routes
	mux.HandleFunc("GET /api/steps", chain(stepsHandler.GetToday, auth))
	mux.HandleFunc("POST /api/steps/sync", chain(stepsHandler.Sync, auth))

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
