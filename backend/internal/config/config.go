package config

import (
	"fmt"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	Port               string
	DatabaseURL        string
	JWTSecret          string
	GoogleClientID     string
	GoogleClientSecret string
	Environment        string
	AllowedOrigins     string
	AssistantProvider  string
	OpenCodeURL        string
	OpenCodeModel      string
	GeminiAPIKey       string
	GeminiModel        string
	MigrationsDir      string
	// PhotoDir is where nutrition photos (plate/label) are written: a bind
	// mount in dev, a PersistentVolumeClaim in production. Without it the
	// backend would write into the container's ephemeral filesystem and lose
	// every photo on the next deploy.
	PhotoDir string
	// ExerciseVideoBucket e ExerciseVideoCredentials dão acesso ao bucket
	// privado dos vídeos de exercício. A credencial é o JSON de uma service
	// account com leitura só nesse bucket, e chega pelo secret do k8s.
	//
	// Ambos são opcionais de propósito: sem eles o backend sobe igual e os
	// endpoints de vídeo respondem 503, o app não mostra vídeo e todo o resto
	// funciona. É o que permite deployar o backend antes de o secret existir —
	// o secret é aplicado à mão, fora do workflow.
	ExerciseVideoBucket      string
	ExerciseVideoCredentials string
}

func Load() (*Config, error) {
	// Load .env file if it exists (ignore error in production)
	_ = godotenv.Load()

	cfg := &Config{
		Port:               getEnv("PORT", "8080"),
		DatabaseURL:        getEnvRequired("DATABASE_URL"),
		JWTSecret:          getEnvRequired("JWT_SECRET"),
		GoogleClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
		Environment:        getEnv("ENVIRONMENT", "development"),
		AllowedOrigins:     getEnv("ALLOWED_ORIGINS", "http://localhost:5173"),
		AssistantProvider:  getEnv("ASSISTANT_PROVIDER", "gemini"),
		OpenCodeURL:        getEnv("OPENCODE_URL", "http://localhost:4096"),
		OpenCodeModel:      getEnv("OPENCODE_MODEL", "openai/gpt-5.6-sol"),
		GeminiAPIKey:       getEnv("GEMINI_API_KEY", ""),
		GeminiModel:        getEnv("GEMINI_MODEL", "gemini-3.6-flash"),
		MigrationsDir:      getEnv("MIGRATIONS_DIR", "/app/migrations"),
		PhotoDir:           getEnv("PHOTO_DIR", "/data/photos"),

		ExerciseVideoBucket:      getEnv("EXERCISE_VIDEO_BUCKET", "malhando-os-bacons-exercicios"),
		ExerciseVideoCredentials: getEnv("EXERCISE_VIDEO_CREDENTIALS", ""),
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvRequired(key string) string {
	value := os.Getenv(key)
	if value == "" {
		panic(fmt.Sprintf("required environment variable %s is not set", key))
	}
	return value
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}
