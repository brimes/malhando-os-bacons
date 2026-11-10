package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port              string
	DatabaseURL       string
	JWTSecret         string
	Environment       string
	AllowedOrigins    string
	AssistantProvider string
	OpenCodeURL       string
	OpenCodeModel     string
	GeminiAPIKey      string
	GeminiModel       string
	MigrationsDir     string
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

	// BrevoAPIKey, BrevoSenderEmail e BrevoSenderName habilitam o e-mail de redefinição de senha.
	// Opcionais pelo mesmo motivo dos vídeos: sem a chave o backend sobe igual
	// e POST /api/auth/password/forgot responde 503.
	BrevoAPIKey      string
	BrevoSenderEmail string
	BrevoSenderName  string

	// GoogleClientIDs: client IDs aceitos como `aud` do idToken do Google
	// (web, iOS e Android). São públicos. Vazio: POST /api/auth/google responde 503.
	GoogleClientIDs []string
	// AppleBundleID e AppleServiceID: `aud` aceitos no identityToken da Apple.
	AppleBundleID  string
	AppleServiceID string
	// AppleTeamID, AppleKeyID e ApplePrivateKey (o conteúdo do .p8) assinam o
	// client_secret usado para trocar o authorizationCode e revogar o token
	// quando a conta é excluída. Opcionais: sem eles o login com Apple funciona
	// e a exclusão apenas não revoga o vínculo na Apple.
	AppleTeamID     string
	AppleKeyID      string
	ApplePrivateKey string
}

func Load() (*Config, error) {
	// Load .env file if it exists (ignore error in production)
	_ = godotenv.Load()

	cfg := &Config{
		Port:              getEnv("PORT", "8080"),
		DatabaseURL:       getEnvRequired("DATABASE_URL"),
		JWTSecret:         getEnvRequired("JWT_SECRET"),
		Environment:       getEnv("ENVIRONMENT", "development"),
		AllowedOrigins:    getEnv("ALLOWED_ORIGINS", "http://localhost:5173"),
		AssistantProvider: getEnv("ASSISTANT_PROVIDER", "gemini"),
		OpenCodeURL:       getEnv("OPENCODE_URL", "http://localhost:4096"),
		OpenCodeModel:     getEnv("OPENCODE_MODEL", "openai/gpt-5.6-sol"),
		GeminiAPIKey:      getEnv("GEMINI_API_KEY", ""),
		GeminiModel:       getEnv("GEMINI_MODEL", "gemini-3.6-flash"),
		MigrationsDir:     getEnv("MIGRATIONS_DIR", "/app/migrations"),
		PhotoDir:          getEnv("PHOTO_DIR", "/data/photos"),

		ExerciseVideoBucket:      getEnv("EXERCISE_VIDEO_BUCKET", "malhando-os-bacons-exercicios"),
		ExerciseVideoCredentials: getEnv("EXERCISE_VIDEO_CREDENTIALS", ""),

		BrevoAPIKey:      getEnv("BREVO_API_KEY", ""),
		BrevoSenderEmail: getEnv("BREVO_SENDER_EMAIL", ""),
		BrevoSenderName:  getEnv("BREVO_SENDER_NAME", "Malhando os Bacons"),

		GoogleClientIDs: splitList(getEnv("GOOGLE_CLIENT_IDS", "")),
		AppleBundleID:   getEnv("APPLE_BUNDLE_ID", "net.brimes.mob"),
		AppleServiceID:  getEnv("APPLE_SERVICE_ID", ""),
		AppleTeamID:     getEnv("APPLE_TEAM_ID", ""),
		AppleKeyID:      getEnv("APPLE_KEY_ID", ""),
		ApplePrivateKey: getEnv("APPLE_PRIVATE_KEY", ""),
	}

	return cfg, nil
}

// splitList lê uma lista separada por vírgulas, ignorando brancos e itens vazios.
func splitList(value string) []string {
	var out []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
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
