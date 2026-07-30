package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/db"
)

// GeneratorResolver decides which credentials a given user's LLM calls run on.
// Whoever saved their own API key spends their own quota; everybody else falls
// back to the shared credits configured on the server.
//
// Resolution takes a context but never the request: plan generation runs in a
// detached goroutine, and it has to resolve there too.
type GeneratorResolver interface {
	For(ctx context.Context, userID int64) StructuredGenerator
	// ChatFor returns the free-text side of the same generator, or
	// ErrChatNotSupported when the provider in use cannot do it.
	ChatFor(ctx context.Context, userID int64) (ChatGenerator, error)
	// VisionFor returns the image side of the same generator, or
	// ErrVisionNotSupported when the provider in use cannot see.
	VisionFor(ctx context.Context, userID int64) (VisionGenerator, error)
}

type userGeneratorResolver struct {
	db           *db.DB
	shared       StructuredGenerator
	defaultModel string

	mutex sync.Mutex
	cache map[int64]cachedGenerator
}

type cachedGenerator struct {
	// fingerprint identifies what the generator was built from, so a user who
	// swaps the key or the model stops getting the stale client back.
	fingerprint string
	generator   StructuredGenerator
}

// NewGeneratorResolver builds a resolver over the shared generator. defaultModel
// is used for users who saved a key but no model.
func NewGeneratorResolver(database *db.DB, shared StructuredGenerator, defaultModel string) GeneratorResolver {
	return &userGeneratorResolver{
		db:           database,
		shared:       shared,
		defaultModel: defaultModel,
		cache:        map[int64]cachedGenerator{},
	}
}

func (r *userGeneratorResolver) For(ctx context.Context, userID int64) StructuredGenerator {
	apiKey, model := r.lookupCredentials(ctx, userID)
	if apiKey == "" {
		return r.shared
	}
	if model == "" {
		model = r.defaultModel
	}

	fingerprint := fingerprintCredentials(apiKey, model)
	r.mutex.Lock()
	defer r.mutex.Unlock()
	if cached, ok := r.cache[userID]; ok && cached.fingerprint == fingerprint {
		return cached.generator
	}
	generator, err := NewGeminiGenerator(apiKey, model)
	if err != nil {
		// A stored key that cannot build a client should not take the feature
		// down for that user: the shared credits still work.
		slog.Warn("failed to build generator from user key, falling back to shared credits",
			"user_id", userID, "error", err)
		return r.shared
	}
	r.cache[userID] = cachedGenerator{fingerprint: fingerprint, generator: generator}
	return generator
}

func (r *userGeneratorResolver) ChatFor(ctx context.Context, userID int64) (ChatGenerator, error) {
	generator, ok := r.For(ctx, userID).(ChatGenerator)
	if !ok {
		return nil, ErrChatNotSupported
	}
	return generator, nil
}

func (r *userGeneratorResolver) VisionFor(ctx context.Context, userID int64) (VisionGenerator, error) {
	generator, ok := r.For(ctx, userID).(VisionGenerator)
	if !ok {
		return nil, ErrVisionNotSupported
	}
	return generator, nil
}

// lookupCredentials reads the user's own key, if any. A failure here is not
// fatal: it just means the request runs on the shared credits.
func (r *userGeneratorResolver) lookupCredentials(ctx context.Context, userID int64) (string, string) {
	var apiKey, model string
	err := r.db.Pool.QueryRow(ctx,
		`SELECT COALESCE(api_key, ''), COALESCE(model, '') FROM user_llm_settings
		 WHERE user_id = $1 AND provider = 'gemini'`, userID).Scan(&apiKey, &model)
	if err == pgx.ErrNoRows {
		return "", ""
	}
	if err != nil {
		slog.Error("failed to load user llm settings", "user_id", userID, "error", err)
		return "", ""
	}
	return apiKey, model
}

// fingerprintCredentials hashes the key so no cleartext credential sits in a
// map key or shows up in a heap dump next to the user id.
func fingerprintCredentials(apiKey, model string) string {
	sum := sha256.Sum256([]byte(apiKey + "\x00" + model))
	return hex.EncodeToString(sum[:])
}
