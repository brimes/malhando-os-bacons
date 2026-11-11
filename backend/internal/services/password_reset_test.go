package services

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type fakeCode struct {
	id       int64
	userID   int64
	hash     string
	attempts int
	expires  time.Time
	used     bool
	created  time.Time
}

type fakeResetStore struct {
	users    map[string]*ResetUser
	codes    []*fakeCode
	password map[int64]string
	nextID   int64
	now      func() time.Time
}

func newFakeResetStore(now func() time.Time) *fakeResetStore {
	return &fakeResetStore{
		users:    map[string]*ResetUser{"ana@example.com": {ID: 7, Name: "Ana <b>"}},
		password: map[int64]string{},
		now:      now,
	}
}

func (f *fakeResetStore) UserByEmail(_ context.Context, email string) (*ResetUser, error) {
	return f.users[email], nil
}
func (f *fakeResetStore) RecentRequests(_ context.Context, userID int64, since time.Time) (int, error) {
	n := 0
	for _, c := range f.codes {
		if c.userID == userID && c.created.After(since) {
			n++
		}
	}
	return n, nil
}
func (f *fakeResetStore) Issue(_ context.Context, userID int64, hash string, exp time.Time) error {
	for _, c := range f.codes {
		if c.userID == userID {
			c.used = true
		}
	}
	f.nextID++
	f.codes = append(f.codes, &fakeCode{id: f.nextID, userID: userID, hash: hash, expires: exp, created: f.now()})
	return nil
}
func (f *fakeResetStore) ClaimAttempt(_ context.Context, userID int64, now time.Time, max int) (*ResetCode, error) {
	for i := len(f.codes) - 1; i >= 0; i-- {
		c := f.codes[i]
		if c.userID == userID && !c.used && c.expires.After(now) && c.attempts < max {
			c.attempts++
			return &ResetCode{ID: c.id, CodeHash: c.hash}, nil
		}
	}
	return nil, nil
}
func (f *fakeResetStore) Redeem(_ context.Context, id, userID int64, pw string) (bool, error) {
	for _, c := range f.codes {
		if c.id == id {
			if c.used {
				return false, nil
			}
		}
	}
	for _, c := range f.codes {
		if c.userID == userID {
			c.used = true
		}
	}
	f.password[userID] = pw
	return true, nil
}

type fakeMailer struct {
	sent []sentMail
	err  error
}
type sentMail struct{ to, name, code string }

func (m *fakeMailer) SendPasswordResetCode(_ context.Context, to, name, code string, _ time.Duration) error {
	m.sent = append(m.sent, sentMail{to, name, code})
	return m.err
}

func newTestService() (*PasswordResetService, *fakeResetStore, *fakeMailer, *time.Time) {
	clock := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	store := newFakeResetStore(func() time.Time { return clock })
	mailer := &fakeMailer{}
	svc := NewPasswordResetService(store, mailer, "segredo-de-teste")
	svc.now = func() time.Time { return clock }
	svc.dispatch = func(f func()) { f() }
	return svc, store, mailer, &clock
}

func TestGenerateResetCodeShape(t *testing.T) {
	for i := 0; i < 200; i++ {
		c, err := GenerateResetCode()
		if err != nil || len(c) != 6 || strings.Trim(c, "0123456789") != "" {
			t.Fatalf("código inválido %q (%v)", c, err)
		}
	}
}

func TestHashDoesNotContainCodeAndDependsOnUser(t *testing.T) {
	svc, _, _, _ := newTestService()
	h1 := svc.HashResetCode(1, "123456")
	if strings.Contains(h1, "123456") {
		t.Fatal("hash contém o código")
	}
	if h1 == svc.HashResetCode(2, "123456") || h1 == svc.HashResetCode(1, "123457") {
		t.Fatal("hash deveria depender do usuário e do código")
	}
	other := NewPasswordResetService(nil, nil, "outro-segredo")
	if h1 == other.HashResetCode(1, "123456") {
		t.Fatal("hash deveria depender do segredo")
	}
}

func TestRequestStoresOnlyHashAndEmailsCode(t *testing.T) {
	svc, store, mailer, _ := newTestService()
	if err := svc.RequestCode(context.Background(), "ana@example.com"); err != nil {
		t.Fatal(err)
	}
	if len(mailer.sent) != 1 || len(store.codes) != 1 {
		t.Fatalf("esperava 1 e-mail e 1 código, sent=%d codes=%d", len(mailer.sent), len(store.codes))
	}
	code := mailer.sent[0].code
	if store.codes[0].hash == code || store.codes[0].hash != svc.HashResetCode(7, code) {
		t.Fatal("o banco deve guardar só o hash")
	}
}

func TestUnknownEmailLooksTheSameAndSendsNothing(t *testing.T) {
	svc, store, mailer, _ := newTestService()
	if err := svc.RequestCode(context.Background(), "ninguem@example.com"); err != nil {
		t.Fatalf("e-mail inexistente deve devolver nil, veio %v", err)
	}
	if len(mailer.sent) != 0 || len(store.codes) != 0 {
		t.Fatal("não deveria enviar nem gravar nada")
	}
}

func TestRequestWithoutMailerIsNotConfigured(t *testing.T) {
	svc := NewPasswordResetService(newFakeResetStore(time.Now), nil, "s")
	if svc.Enabled() {
		t.Fatal("sem mailer o recurso deve estar desativado")
	}
	if err := svc.RequestCode(context.Background(), "ana@example.com"); !errors.Is(err, ErrResetNotConfigured) {
		t.Fatalf("esperava ErrResetNotConfigured, veio %v", err)
	}
}

func TestMailerFailureStillLooksSuccessful(t *testing.T) {
	svc, _, mailer, _ := newTestService()
	mailer.err = errors.New("brevo fora do ar")
	if err := svc.RequestCode(context.Background(), "ana@example.com"); err != nil {
		t.Fatalf("falha do provedor não pode vazar: %v", err)
	}
}

func TestRequestRateLimit(t *testing.T) {
	svc, _, mailer, clock := newTestService()
	for i := 0; i < ResetMaxRequests+3; i++ {
		_ = svc.RequestCode(context.Background(), "ana@example.com")
	}
	if len(mailer.sent) != ResetMaxRequests {
		t.Fatalf("enviados %d, esperado %d", len(mailer.sent), ResetMaxRequests)
	}
	*clock = clock.Add(ResetRequestWindow + time.Minute)
	_ = svc.RequestCode(context.Background(), "ana@example.com")
	if len(mailer.sent) != ResetMaxRequests+1 {
		t.Fatal("depois da janela, novos pedidos voltam a valer")
	}
}

func TestResetHappyPathIsSingleUse(t *testing.T) {
	svc, store, mailer, _ := newTestService()
	_ = svc.RequestCode(context.Background(), "ana@example.com")
	code := mailer.sent[0].code

	if _, err := svc.Reset(context.Background(), "ana@example.com", code, "novasenha123"); err != nil {
		t.Fatalf("reset válido falhou: %v", err)
	}
	if bcrypt.CompareHashAndPassword([]byte(store.password[7]), []byte("novasenha123")) != nil {
		t.Fatal("senha nova não foi gravada como bcrypt")
	}
	if _, err := svc.Reset(context.Background(), "ana@example.com", code, "outrasenha123"); !errors.Is(err, ErrInvalidResetCode) {
		t.Fatalf("segundo uso deveria falhar, veio %v", err)
	}
}

func TestResetRejectsWrongAndExpiredAndUnknown(t *testing.T) {
	svc, _, mailer, clock := newTestService()
	_ = svc.RequestCode(context.Background(), "ana@example.com")
	code := mailer.sent[0].code
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	if _, err := svc.Reset(context.Background(), "ana@example.com", wrong, "novasenha123"); !errors.Is(err, ErrInvalidResetCode) {
		t.Fatalf("código errado: %v", err)
	}
	if _, err := svc.Reset(context.Background(), "ninguem@example.com", code, "novasenha123"); !errors.Is(err, ErrInvalidResetCode) {
		t.Fatalf("e-mail inexistente deve dar o mesmo erro: %v", err)
	}
	*clock = clock.Add(ResetCodeTTL + time.Second)
	if _, err := svc.Reset(context.Background(), "ana@example.com", code, "novasenha123"); !errors.Is(err, ErrInvalidResetCode) {
		t.Fatalf("código expirado deve falhar: %v", err)
	}
}

func TestResetAttemptLimitBurnsTheCode(t *testing.T) {
	svc, store, mailer, _ := newTestService()
	_ = svc.RequestCode(context.Background(), "ana@example.com")
	code := mailer.sent[0].code
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for i := 0; i < ResetMaxAttempts; i++ {
		_, _ = svc.Reset(context.Background(), "ana@example.com", wrong, "novasenha123")
	}
	// Agora nem o código certo vale.
	if _, err := svc.Reset(context.Background(), "ana@example.com", code, "novasenha123"); !errors.Is(err, ErrInvalidResetCode) {
		t.Fatalf("código esgotado deve falhar mesmo certo: %v", err)
	}
	if _, ok := store.password[7]; ok {
		t.Fatal("a senha não deveria ter mudado")
	}
}

func TestNewRequestInvalidatesPreviousCode(t *testing.T) {
	svc, _, mailer, _ := newTestService()
	_ = svc.RequestCode(context.Background(), "ana@example.com")
	_ = svc.RequestCode(context.Background(), "ana@example.com")
	first, second := mailer.sent[0].code, mailer.sent[1].code
	if first != second {
		if _, err := svc.Reset(context.Background(), "ana@example.com", first, "novasenha123"); !errors.Is(err, ErrInvalidResetCode) {
			t.Fatalf("o código antigo deveria estar invalidado: %v", err)
		}
	}
	if _, err := svc.Reset(context.Background(), "ana@example.com", second, "novasenha123"); err != nil {
		t.Fatalf("o código novo deveria valer: %v", err)
	}
}
