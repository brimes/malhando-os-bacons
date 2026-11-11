package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserIDKey contextKey = "user_id"

type Claims struct {
	UserID int64  `json:"user_id"`
	Email  string `json:"email"`
	// TokenVersion (`tv`) é comparado com users.token_version. Token antigo, sem
	// o campo, lê como 0 — a versão de todo mundo no deploy.
	TokenVersion int `json:"tv"`
	jwt.RegisteredClaims
}

func GenerateToken(userID int64, email, secret string, tokenVersion int) (string, error) {
	claims := Claims{
		UserID:       userID,
		Email:        email,
		TokenVersion: tokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "mob-api",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ErrUserNotFound: o lookup não achou o usuário (conta excluída).
var ErrUserNotFound = errors.New("user not found")

// TokenVersionCache guarda users.token_version por pouco tempo para que a
// checagem não custe uma query por requisição. Quem incrementa a versão neste
// processo chama Invalidate; em outro processo, vale o TTL.
type TokenVersionCache struct {
	lookup func(ctx context.Context, userID int64) (int, error)
	ttl    time.Duration
	now    func() time.Time
	mu     sync.Mutex
	m      map[int64]cachedVersion
}

type cachedVersion struct {
	version int
	expires time.Time
}

func NewTokenVersionCache(lookup func(ctx context.Context, userID int64) (int, error), ttl time.Duration) *TokenVersionCache {
	return &TokenVersionCache{lookup: lookup, ttl: ttl, now: time.Now, m: make(map[int64]cachedVersion)}
}

func (c *TokenVersionCache) Version(ctx context.Context, userID int64) (int, error) {
	c.mu.Lock()
	e, ok := c.m[userID]
	c.mu.Unlock()
	if ok && c.now().Before(e.expires) {
		return e.version, nil
	}
	v, err := c.lookup(ctx, userID)
	if err != nil {
		return 0, err
	}
	c.mu.Lock()
	if len(c.m) > 10000 { // teto simples; o cache é só otimização
		c.m = make(map[int64]cachedVersion)
	}
	c.m[userID] = cachedVersion{version: v, expires: c.now().Add(c.ttl)}
	c.mu.Unlock()
	return v, nil
}

func (c *TokenVersionCache) Invalidate(userID int64) {
	c.mu.Lock()
	delete(c.m, userID)
	c.mu.Unlock()
}

// TokenVersions é o que o middleware precisa para validar `tv`.
type TokenVersions interface {
	Version(ctx context.Context, userID int64) (int, error)
}

func AuthMiddleware(jwtSecret string, versions TokenVersions) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				writeError(w, http.StatusUnauthorized, "missing authorization header")
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
				writeError(w, http.StatusUnauthorized, "invalid authorization header format")
				return
			}

			tokenStr := parts[1]
			claims := &Claims{}

			token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return []byte(jwtSecret), nil
			})

			if err != nil || !token.Valid {
				writeError(w, http.StatusUnauthorized, "invalid or expired token")
				return
			}

			current, err := versions.Version(r.Context(), claims.UserID)
			switch {
			case errors.Is(err, ErrUserNotFound):
				writeError(w, http.StatusUnauthorized, "invalid or expired token")
				return
			case err != nil:
				slog.Error("token version lookup failed", "user_id", claims.UserID, "error", err)
				writeError(w, http.StatusServiceUnavailable, "could not validate session")
				return
			case current != claims.TokenVersion:
				writeError(w, http.StatusUnauthorized, "session expired")
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetUserID(ctx context.Context) (int64, bool) {
	userID, ok := ctx.Value(UserIDKey).(int64)
	return userID, ok
}

func CORSMiddleware(allowedOrigins string) func(http.Handler) http.Handler {
	origins := strings.Split(allowedOrigins, ",")
	allowedMap := make(map[string]bool)
	for _, o := range origins {
		allowedMap[strings.TrimSpace(o)] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if allowedMap[origin] || allowedOrigins == "*" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Max-Age", "86400")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
