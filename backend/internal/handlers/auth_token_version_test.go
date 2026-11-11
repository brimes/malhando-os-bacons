package handlers

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/services"
)

// Estes testes precisam de um Postgres DESCARTÁVEL em TEST_DATABASE_URL (nunca
// o banco local, que tem dados reais). Sem a variável, são pulados.
func testDB(t *testing.T) *db.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL não definido")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	d := &db.DB{Pool: pool}
	if err := db.Migrate(ctx, d, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	return d
}

func newUser(t *testing.T, d *db.DB, email string, withPassword bool) int64 {
	t.Helper()
	var hash any
	if withPassword {
		hash = "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012"
	}
	var id int64
	if err := d.Pool.QueryRow(context.Background(),
		`INSERT INTO users (email, name, password_hash) VALUES ($1, 'T', $2) RETURNING id`, email, hash).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id) })
	return id
}

func state(t *testing.T, d *db.DB, id int64) (hasPw bool, tv int) {
	t.Helper()
	if err := d.Pool.QueryRow(context.Background(),
		`SELECT password_hash IS NOT NULL, token_version FROM users WHERE id = $1`, id).Scan(&hasPw, &tv); err != nil {
		t.Fatal(err)
	}
	return
}

func TestSocialLinkClearsPasswordAndBumpsVersion(t *testing.T) {
	d := testDB(t)
	id := newUser(t, d, "vitima-link@example.com", true)
	h := &AuthHandler{db: d}
	ident := &services.Identity{Subject: "g-link-1", Email: "vitima-link@example.com", EmailVerified: true}

	u, _, _ := h.socialLogin(context.Background(), providerGoogle, ident, "", "")
	if u == nil || u.HasPassword || u.TokenVersion != 1 {
		t.Fatalf("usuário após vincular: %+v", u)
	}
	if hasPw, tv := state(t, d, id); hasPw || tv != 1 {
		t.Fatalf("banco: has_password=%v tv=%d", hasPw, tv)
	}

	// Login normal com o provedor já vinculado não mexe em nada.
	u, _, _ = h.socialLogin(context.Background(), providerGoogle, ident, "", "")
	if u == nil || u.TokenVersion != 1 {
		t.Fatalf("segundo login: %+v", u)
	}
	if _, tv := state(t, d, id); tv != 1 {
		t.Fatalf("segundo login mexeu na versão: %d", tv)
	}
}

func TestSocialLinkWithoutPasswordKeepsVersionAndNormalLoginUntouched(t *testing.T) {
	d := testDB(t)
	id := newUser(t, d, "sem-senha-link@example.com", false)
	h := &AuthHandler{db: d}
	ident := &services.Identity{Subject: "a-link-2", Email: "sem-senha-link@example.com", EmailVerified: true}
	if u, _, _ := h.socialLogin(context.Background(), providerApple, ident, "", ""); u == nil {
		t.Fatal("login falhou")
	}
	if hasPw, tv := state(t, d, id); hasPw || tv != 0 {
		t.Fatalf("conta sem senha: has_password=%v tv=%d", hasPw, tv)
	}
}

func TestPasswordResetBumpsVersion(t *testing.T) {
	d := testDB(t)
	id := newUser(t, d, "reset-tv@example.com", true)
	svc := services.NewPasswordResetService(services.NewPGPasswordResetStore(d), nil, "s")
	ctx := context.Background()
	code := "123456"
	if _, err := d.Pool.Exec(ctx,
		`INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)`,
		id, svc.HashResetCode(id, code), time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	got, err := svc.Reset(ctx, "reset-tv@example.com", code, "novasenha123")
	if err != nil || got != id {
		t.Fatalf("reset: id=%d err=%v", got, err)
	}
	if hasPw, tv := state(t, d, id); !hasPw || tv != 1 {
		t.Fatalf("após reset: has_password=%v tv=%d", hasPw, tv)
	}
}
