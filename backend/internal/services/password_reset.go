package services

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/db"
	"golang.org/x/crypto/bcrypt"
)

const (
	ResetCodeTTL         = 15 * time.Minute
	ResetMaxAttempts     = 5
	ResetMaxRequests     = 5 // por usuário, dentro de ResetRequestWindow
	ResetRequestWindow   = time.Hour
	resetCodeDigits      = 6
	resetMailSendTimeout = 30 * time.Second
)

var (
	// ErrResetNotConfigured: sem BREVO_API_KEY não há como entregar o código.
	ErrResetNotConfigured = errors.New("password reset email is not configured")
	// ErrInvalidResetCode é a única resposta para código errado, expirado,
	// esgotado, já usado ou e-mail sem conta: quem erra não aprende qual foi.
	ErrInvalidResetCode = errors.New("invalid or expired reset code")
)

// ResetUser é o mínimo de um usuário que o fluxo precisa.
type ResetUser struct {
	ID   int64
	Name string
}

// ResetCode é uma linha de password_reset_codes ainda utilizável.
type ResetCode struct {
	ID       int64
	CodeHash string
}

// PasswordResetStore isola o SQL para que a regra possa ser testada sem banco.
type PasswordResetStore interface {
	UserByEmail(ctx context.Context, email string) (*ResetUser, error) // nil, nil se não existe
	RecentRequests(ctx context.Context, userID int64, since time.Time) (int, error)
	// Issue invalida os códigos anteriores do usuário e grava o novo.
	Issue(ctx context.Context, userID int64, codeHash string, expiresAt time.Time) error
	// ClaimAttempt conta, de forma atômica, uma tentativa no código mais recente
	// ainda utilizável (não usado, não expirado, abaixo do teto) e o devolve.
	// A tentativa é contada ANTES de comparar: assim requisições paralelas não
	// conseguem testar mais palpites que o teto.
	ClaimAttempt(ctx context.Context, userID int64, now time.Time, maxAttempts int) (*ResetCode, error) // nil, nil se não há
	// Redeem marca o código como usado (uso único), grava a senha nova e apaga
	// os demais códigos do usuário, tudo numa transação. false se já fora usado.
	Redeem(ctx context.Context, codeID, userID int64, passwordHash string) (bool, error)
}

type PasswordResetService struct {
	store  PasswordResetStore
	mailer Mailer // nil: recurso desativado
	secret []byte
	now    func() time.Time
	// dispatch roda o envio do e-mail. Em produção é uma goroutine, para que a
	// resposta de e-mail existente e inexistente demore o mesmo; os testes o
	// trocam por uma chamada direta.
	dispatch func(func())
}

func NewPasswordResetService(store PasswordResetStore, mailer Mailer, secret string) *PasswordResetService {
	return &PasswordResetService{
		store: store, mailer: mailer, secret: []byte(secret), now: time.Now,
		dispatch: func(f func()) { go f() },
	}
}

func (s *PasswordResetService) Enabled() bool { return s.mailer != nil }

// GenerateResetCode devolve 6 dígitos uniformes de crypto/rand.
func GenerateResetCode() (string, error) {
	max := new(big.Int).Exp(big.NewInt(10), big.NewInt(resetCodeDigits), nil)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", resetCodeDigits, n), nil
}

// HashResetCode é um HMAC-SHA256 com o segredo do servidor, amarrado ao usuário.
// Um hash simples de 6 dígitos cairia em força bruta de um milhão de tentativas
// se o banco vazasse; com o segredo, só quem tem o segredo e o banco consegue.
func (s *PasswordResetService) HashResetCode(userID int64, code string) string {
	mac := hmac.New(sha256.New, s.secret)
	fmt.Fprintf(mac, "password-reset:%d:%s", userID, code)
	return hex.EncodeToString(mac.Sum(nil))
}

// RequestCode emite e envia um código. Devolve ErrResetNotConfigured sem mailer;
// em todos os outros casos (e-mail inexistente, limite de pedidos, falha do
// provedor) devolve nil e o chamador responde igual — a resposta não pode
// revelar quais e-mails têm conta.
func (s *PasswordResetService) RequestCode(ctx context.Context, email string) error {
	if s.mailer == nil {
		return ErrResetNotConfigured
	}
	user, err := s.store.UserByEmail(ctx, email)
	if err != nil {
		slog.Error("password reset: lookup failed", "error", err)
		return nil
	}
	if user == nil {
		return nil
	}
	now := s.now()
	recent, err := s.store.RecentRequests(ctx, user.ID, now.Add(-ResetRequestWindow))
	if err != nil {
		slog.Error("password reset: rate check failed", "user_id", user.ID, "error", err)
		return nil
	}
	if recent >= ResetMaxRequests {
		slog.Warn("password reset: request limit reached", "user_id", user.ID)
		return nil
	}
	code, err := GenerateResetCode()
	if err != nil {
		slog.Error("password reset: code generation failed", "error", err)
		return nil
	}
	if err := s.store.Issue(ctx, user.ID, s.HashResetCode(user.ID, code), now.Add(ResetCodeTTL)); err != nil {
		slog.Error("password reset: could not store code", "user_id", user.ID, "error", err)
		return nil
	}
	name := user.Name
	s.dispatch(func() {
		ctx, cancel := context.WithTimeout(context.Background(), resetMailSendTimeout)
		defer cancel()
		if err := s.mailer.SendPasswordResetCode(ctx, email, name, code, ResetCodeTTL); err != nil {
			slog.Error("password reset: email not sent", "user_id", user.ID, "error", err)
		}
	})
	return nil
}

// Reset valida o código e troca a senha. Qualquer falha de validação é
// ErrInvalidResetCode.
func (s *PasswordResetService) Reset(ctx context.Context, email, code, newPassword string) error {
	user, err := s.store.UserByEmail(ctx, email)
	if err != nil {
		return err
	}
	if user == nil {
		return ErrInvalidResetCode
	}
	claimed, err := s.store.ClaimAttempt(ctx, user.ID, s.now(), ResetMaxAttempts)
	if err != nil {
		return err
	}
	if claimed == nil {
		return ErrInvalidResetCode
	}
	if !hmac.Equal([]byte(claimed.CodeHash), []byte(s.HashResetCode(user.ID, code))) {
		return ErrInvalidResetCode
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	ok, err := s.store.Redeem(ctx, claimed.ID, user.ID, string(passwordHash))
	if err != nil {
		return err
	}
	if !ok {
		return ErrInvalidResetCode
	}
	return nil
}

// PGPasswordResetStore implementa o store sobre o Postgres.
type PGPasswordResetStore struct{ db *db.DB }

func NewPGPasswordResetStore(database *db.DB) *PGPasswordResetStore {
	return &PGPasswordResetStore{db: database}
}

func (p *PGPasswordResetStore) UserByEmail(ctx context.Context, email string) (*ResetUser, error) {
	var u ResetUser
	err := p.db.Pool.QueryRow(ctx, `SELECT id, name FROM users WHERE email = $1`, email).Scan(&u.ID, &u.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (p *PGPasswordResetStore) RecentRequests(ctx context.Context, userID int64, since time.Time) (int, error) {
	var n int
	err := p.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM password_reset_codes WHERE user_id = $1 AND created_at > $2`,
		userID, since).Scan(&n)
	return n, err
}

// Issue não apaga as linhas antigas, só as inutiliza (used_at): elas continuam
// contando para o limite de pedidos por hora.
func (p *PGPasswordResetStore) Issue(ctx context.Context, userID int64, codeHash string, expiresAt time.Time) error {
	tx, err := p.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE password_reset_codes SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, codeHash, expiresAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (p *PGPasswordResetStore) ClaimAttempt(ctx context.Context, userID int64, now time.Time, maxAttempts int) (*ResetCode, error) {
	var c ResetCode
	err := p.db.Pool.QueryRow(ctx,
		`UPDATE password_reset_codes SET attempts = attempts + 1
		 WHERE id = (
		     SELECT id FROM password_reset_codes
		     WHERE user_id = $1 AND used_at IS NULL AND expires_at > $2 AND attempts < $3
		     ORDER BY id DESC LIMIT 1
		 )
		 RETURNING id, code_hash`, userID, now, maxAttempts).Scan(&c.ID, &c.CodeHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (p *PGPasswordResetStore) Redeem(ctx context.Context, codeID, userID int64, passwordHash string) (bool, error) {
	tx, err := p.db.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx,
		`UPDATE password_reset_codes SET used_at = NOW() WHERE id = $1 AND used_at IS NULL`, codeID)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() != 1 {
		return false, nil
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2`, passwordHash, userID); err != nil {
		return false, err
	}
	// Códigos restantes não podem sobreviver a uma senha nova.
	if _, err := tx.Exec(ctx,
		`UPDATE password_reset_codes SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, userID); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
