package handlers

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestRequestTimeZone(t *testing.T) {
	cases := []struct {
		name, header, query, want string
	}{
		{"header valido", "America/New_York", "", "America/New_York"},
		{"query como alternativa", "", "Europe/Lisbon", "Europe/Lisbon"},
		{"header vence a query", "Asia/Tokyo", "Europe/Lisbon", "Asia/Tokyo"},
		{"ausente cai em Brasilia", "", "", "America/Sao_Paulo"},
		{"invalido cai em Brasilia", "Marte/Olympus", "", "America/Sao_Paulo"},
		{"Local nao e IANA", "Local", "", "America/Sao_Paulo"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			target := "/api/workouts"
			if tc.query != "" {
				target += "?tz=" + tc.query
			}
			req := httptest.NewRequest("GET", target, nil)
			if tc.header != "" {
				req.Header.Set("X-Timezone", tc.header)
			}
			got, loc := requestTimeZone(req)
			if got != tc.want {
				t.Errorf("fuso = %q, quer %q", got, tc.want)
			}
			if loc == nil {
				t.Fatal("loc nulo")
			}
		})
	}
}

func TestLocalDateSeparaODiaLocalDoUTC(t *testing.T) {
	_, loc := resolveTimeZone("America/Sao_Paulo")
	// 15/11 22:30 em Brasilia = 16/11 01:30 UTC: o dia do treino e 15.
	instant := time.Date(2026, time.November, 16, 1, 30, 0, 0, time.UTC)
	got := localDate(instant, loc)
	want := time.Date(2026, time.November, 15, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("localDate = %s, quer %s", got, want)
	}
}
