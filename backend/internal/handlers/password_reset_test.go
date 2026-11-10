package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mob/backend/internal/services"
)

type stubStore struct{ known bool }

func (s stubStore) UserByEmail(context.Context, string) (*services.ResetUser, error) {
	if s.known {
		return &services.ResetUser{ID: 1, Name: "Ana"}, nil
	}
	return nil, nil
}
func (stubStore) RecentRequests(context.Context, int64, time.Time) (int, error) { return 0, nil }
func (stubStore) Issue(context.Context, int64, string, time.Time) error         { return nil }
func (stubStore) ClaimAttempt(context.Context, int64, time.Time, int) (*services.ResetCode, error) {
	return nil, nil
}
func (stubStore) Redeem(context.Context, int64, int64, string) (bool, error) { return false, nil }

type nopMailer struct{}

func (nopMailer) SendPasswordResetCode(context.Context, string, string, string, time.Duration) error {
	return nil
}

func post(h http.HandlerFunc, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)))
	return rec
}

func TestForgotPasswordSameReplyForKnownAndUnknownEmail(t *testing.T) {
	mk := func(known bool) *AuthHandler {
		return &AuthHandler{svc: AuthServices{PasswordReset: services.NewPasswordResetService(stubStore{known}, nopMailer{}, "s")}}
	}
	a := post(mk(true).ForgotPassword, `{"email":"ana@example.com"}`)
	b := post(mk(false).ForgotPassword, `{"email":"ninguem@example.com"}`)
	c := post(mk(false).ForgotPassword, `{"email":"nao-e-email"}`)
	for _, rec := range []*httptest.ResponseRecorder{a, b, c} {
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d, esperado 200", rec.Code)
		}
	}
	if a.Body.String() != b.Body.String() || b.Body.String() != c.Body.String() {
		t.Fatalf("as respostas deveriam ser idênticas:\n%s\n%s\n%s", a.Body, b.Body, c.Body)
	}
}

func TestForgotPasswordIs503WithoutBrevoKey(t *testing.T) {
	h := &AuthHandler{svc: AuthServices{PasswordReset: services.NewPasswordResetService(stubStore{true}, nil, "s")}}
	if rec := post(h.ForgotPassword, `{"email":"ana@example.com"}`); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, esperado 503", rec.Code)
	}
}

func TestResetPasswordValidation(t *testing.T) {
	h := &AuthHandler{svc: AuthServices{PasswordReset: services.NewPasswordResetService(stubStore{false}, nopMailer{}, "s")}}
	if rec := post(h.ResetPassword, `{"email":"a@b.com","code":"123456","new_password":"curta"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("senha curta: %d", rec.Code)
	}
	rec := post(h.ResetPassword, `{"email":"ninguem@b.com","code":"123456","new_password":"umasenhaboa1"}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "código inválido ou expirado") {
		t.Fatalf("e-mail inexistente deve dar o erro genérico: %d %s", rec.Code, rec.Body)
	}
}

func TestSocialEndpointsAre503WhenNotConfigured(t *testing.T) {
	h := &AuthHandler{}
	if rec := post(h.GoogleLogin, `{"id_token":"x"}`); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("google sem config: %d", rec.Code)
	}
}
