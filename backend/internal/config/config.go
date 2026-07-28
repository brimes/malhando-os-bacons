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
