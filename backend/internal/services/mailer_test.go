package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBrevoMailerSendsExpectedRequest(t *testing.T) {
	var gotKey, gotAccept string
	var got brevoRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey, gotAccept = r.Header.Get("api-key"), r.Header.Get("accept")
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"messageId":"<x@y>"}`))
	}))
	defer srv.Close()

	m := NewBrevoMailer("brevo_chave", "nao-responda@b.com", "")
	m.endpoint = srv.URL
	if err := m.SendPasswordResetCode(context.Background(), "ana@example.com", "Ana", "123456", 15*time.Minute); err != nil {
		t.Fatal(err)
	}
	if gotKey != "brevo_chave" || gotAccept != "application/json" || got.Sender.Email != "nao-responda@b.com" ||
		got.Sender.Name != "MOB" || got.To[0].Email != "ana@example.com" {
		t.Fatalf("requisição inesperada: %q %+v", gotKey, got)
	}
	if !strings.Contains(got.HTMLContent, "123456") || !strings.Contains(got.TextContent, "123456") || !strings.Contains(got.TextContent, "15 minutos") {
		t.Fatal("e-mail deve trazer o código e a validade em HTML e texto")
	}
}

func TestBrevoMailerReportsErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"code":"unauthorized","message":"Key not found","echo":"SEGREDO-ECOADO"}`, http.StatusUnauthorized)
	}))
	defer srv.Close()
	m := NewBrevoMailer("k", "a@b.com", "")
	m.endpoint = srv.URL
	if err := m.SendPasswordResetCode(context.Background(), "a@b.com", "", "123456", time.Minute); err == nil {
		t.Fatal("status 401 deve virar erro")
	} else if strings.Contains(err.Error(), "SEGREDO-ECOADO") || !strings.Contains(err.Error(), "unauthorized") {
		t.Fatalf("o erro deve ter só status, code e message: %v", err)
	}
}

func TestPasswordResetEmailEscapesName(t *testing.T) {
	_, html, _ := PasswordResetEmail(`<script>x</script>`, "123456", 15*time.Minute)
	if strings.Contains(html, "<script>") {
		t.Fatal("nome deve ser escapado no HTML")
	}
}
