package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type fakeVersions struct {
	v     int
	calls int
}

func (f *fakeVersions) Version(context.Context, int64) (int, error) { f.calls++; return f.v, nil }

func serve(t *testing.T, versions TokenVersions, token string) int {
	t.Helper()
	h := AuthMiddleware("secret", versions)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func TestRejectsStaleTokenVersion(t *testing.T) {
	tok, _ := GenerateToken(1, "a@b.c", "secret", 0)
	if code := serve(t, &fakeVersions{v: 1}, tok); code != http.StatusUnauthorized {
		t.Fatalf("token tv=0 com banco em 1: %d, esperado 401", code)
	}
	tok1, _ := GenerateToken(1, "a@b.c", "secret", 1)
	if code := serve(t, &fakeVersions{v: 1}, tok1); code != http.StatusOK {
		t.Fatalf("token tv=1 com banco em 1: %d, esperado 200", code)
	}
}

func TestTokenWithoutTvCountsAsZero(t *testing.T) {
	// Token emitido antes da migration: sem o claim `tv`.
	old := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": 1, "email": "a@b.c", "iss": "mob-api",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	s, _ := old.SignedString([]byte("secret"))
	if code := serve(t, &fakeVersions{v: 0}, s); code != http.StatusOK {
		t.Fatalf("token sem tv com versão 0: %d, esperado 200", code)
	}
	if code := serve(t, &fakeVersions{v: 1}, s); code != http.StatusUnauthorized {
		t.Fatalf("token sem tv com versão 1: %d, esperado 401", code)
	}
}

func TestVersionCacheTTLAndInvalidate(t *testing.T) {
	calls, v := 0, 0
	c := NewTokenVersionCache(func(context.Context, int64) (int, error) { calls++; return v, nil }, 30*time.Second)
	now := time.Now()
	c.now = func() time.Time { return now }
	c.Version(context.Background(), 1)
	c.Version(context.Background(), 1)
	if calls != 1 {
		t.Fatalf("segunda leitura deveria vir do cache, calls=%d", calls)
	}
	v = 1
	c.Invalidate(1)
	if got, _ := c.Version(context.Background(), 1); got != 1 || calls != 2 {
		t.Fatalf("após Invalidate: got=%d calls=%d", got, calls)
	}
	v = 2
	now = now.Add(31 * time.Second)
	if got, _ := c.Version(context.Background(), 1); got != 2 {
		t.Fatalf("após TTL: got=%d", got)
	}
}
