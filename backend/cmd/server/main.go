package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/mob/backend/internal/config"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/routes"
	"github.com/mob/backend/internal/services"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	database, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	slog.Info("connected to database")

	// Migrations run here because nothing else does outside docker-compose,
	// whose initdb hook only fires on an empty volume.
	migrationCtx, migrationCancel := context.WithTimeout(context.Background(), 2*time.Minute)
	if err := db.Migrate(migrationCtx, database, cfg.MigrationsDir); err != nil {
		migrationCancel()
		slog.Error("failed to apply migrations", "error", err)
		os.Exit(1)
	}
	migrationCancel()

	// Plan generation runs in an in-process goroutine, so anything still pending
	// was orphaned by the previous shutdown and will never finish on its own.
	// Failing it here stops the client from polling a job that is already dead.
	// Nutrition plan generation uses the exact same pattern and has the same problem.
	if tag, err := database.Pool.Exec(ctx,
		`UPDATE training_plan_jobs SET status='failed', updated_at=NOW(),
		 error='a geração foi interrompida por um reinício do servidor; tente novamente'
		 WHERE status='pending'`); err != nil {
		slog.Error("failed to clear orphaned training plan jobs", "error", err)
	} else if tag.RowsAffected() > 0 {
		slog.Info("cleared orphaned training plan jobs", "count", tag.RowsAffected())
	}
	if tag, err := database.Pool.Exec(ctx,
		`UPDATE nutrition_plan_jobs SET status='failed', updated_at=NOW(),
		 error='a geração foi interrompida por um reinício do servidor; tente novamente'
		 WHERE status='pending'`); err != nil {
		slog.Error("failed to clear orphaned nutrition plan jobs", "error", err)
	} else if tag.RowsAffected() > 0 {
		slog.Info("cleared orphaned nutrition plan jobs", "count", tag.RowsAffected())
	}

	if err := os.MkdirAll(cfg.PhotoDir, 0o755); err != nil {
		slog.Error("failed to create photo directory", "dir", cfg.PhotoDir, "error", err)
		os.Exit(1)
	}

	generator, err := newAssistantGenerator(cfg)
	if err != nil {
		slog.Error("failed to configure assistant provider", "provider", cfg.AssistantProvider, "error", err)
		os.Exit(1)
	}
	// The configured provider is the shared credit: users who saved their own
	// Gemini key run on it instead, which the resolver decides per user.
	resolver := services.NewGeneratorResolver(database, generator, cfg.GeminiModel)

	// O assinador dos vídeos é opcional: sem credencial o backend sobe igual,
	// os endpoints de vídeo respondem 503 e o app segue sem vídeo. Sem isso,
	// deployar o backend antes de aplicar o secret — que é manual, fora do
	// workflow — derrubaria a API inteira por causa de um recurso acessório.
	var videoSigner *services.GCSSigner
	if cfg.ExerciseVideoCredentials == "" {
		slog.Warn("vídeos de exercício desativados: EXERCISE_VIDEO_CREDENTIALS não configurado")
	} else if videoSigner, err = services.NewGCSSigner(
		cfg.ExerciseVideoBucket, cfg.ExerciseVideoCredentials, 7*24*time.Hour); err != nil {
		// Credencial presente porém inválida é erro de configuração e precisa
		// aparecer, mas ainda não é motivo para o app inteiro ficar fora do ar.
		slog.Error("credencial dos vídeos de exercício inválida", "error", err)
		videoSigner = nil
	} else {
		slog.Info("vídeos de exercício ativos", "bucket", cfg.ExerciseVideoBucket)
	}

	handler := routes.Setup(database, resolver, videoSigner, cfg.JWTSecret, cfg.GoogleClientID, cfg.AllowedOrigins, cfg.PhotoDir)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Port),
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("starting server", "port", cfg.Port, "env", cfg.Environment)
		serverErrors <- server.ListenAndServe()
	}()

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		slog.Error("server error", "error", err)
		os.Exit(1)

	case sig := <-shutdown:
		slog.Info("shutdown signal received", "signal", sig)

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			slog.Error("graceful shutdown failed", "error", err)
			server.Close()
		}
	}

	slog.Info("server stopped")
}

// newAssistantGenerator picks the LLM backend the assistants talk to.
// Swapping providers (or rotating an API key) is a config change, not a rebuild.
func newAssistantGenerator(cfg *config.Config) (services.StructuredGenerator, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.AssistantProvider)) {
	case "gemini":
		slog.Info("using assistant provider", "provider", "gemini", "model", cfg.GeminiModel)
		return services.NewGeminiGenerator(cfg.GeminiAPIKey, cfg.GeminiModel)
	case "opencode":
		slog.Info("using assistant provider", "provider", "opencode", "model", cfg.OpenCodeModel)
		return services.NewOpenCodeGenerator(cfg.OpenCodeURL, cfg.OpenCodeModel)
	default:
		return nil, fmt.Errorf("ASSISTANT_PROVIDER must be gemini or opencode, got %q", cfg.AssistantProvider)
	}
}
