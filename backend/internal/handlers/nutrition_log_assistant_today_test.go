package handlers

import (
	"testing"
	"time"
)

func TestResolveToday(t *testing.T) {
	// 21:52 em Brasília de 15/11 = 00:52 UTC de 16/11.
	now := time.Date(2026, 11, 16, 0, 52, 0, 0, time.UTC)
	cases := map[string]string{
		"2026-11-15": "2026-11-15", // cliente manda o dia local
		"2026-11-16": "2026-11-16",
		"2026-11-17": "2026-11-17", // +1 dia do UTC ainda é aceito
		"2026-11-18": "2026-11-15", // além de ±1 dia: rejeita, usa Brasília
		"2026-11-01": "2026-11-15", // muito antigo
		"lixo":       "2026-11-15",
		"":           "2026-11-15", // sem campo: Brasília, não UTC
	}
	for in, want := range cases {
		if got := resolveToday(in, now); got != want {
			t.Errorf("resolveToday(%q) = %q, quer %q", in, got, want)
		}
	}
}
