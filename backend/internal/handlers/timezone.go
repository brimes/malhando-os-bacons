package handlers

import (
	"net/http"
	"strings"
	"time"
)

// defaultTimeZone é o fuso usado quando o app não informa um válido.
const defaultTimeZone = "America/Sao_Paulo"

// requestTimeZone devolve o fuso IANA do aparelho (header X-Timezone, ou ?tz=
// como alternativa). O dia de um treino é o dia LOCAL de quem treina:
// agrupar por `date::date` usaria o fuso da sessão do Postgres (UTC) e jogaria
// o treino das 22h de Brasília no dia seguinte. Nome inválido ou ausente cai em
// America/Sao_Paulo; o nome só segue para o SQL depois de passar por
// time.LoadLocation (e mesmo assim vai como parâmetro, nunca interpolado).
func requestTimeZone(r *http.Request) (string, *time.Location) {
	name := strings.TrimSpace(r.Header.Get("X-Timezone"))
	if name == "" {
		name = strings.TrimSpace(r.URL.Query().Get("tz"))
	}
	return resolveTimeZone(name)
}

func resolveTimeZone(name string) (string, *time.Location) {
	if name != "" && name != "Local" {
		if loc, err := time.LoadLocation(name); err == nil {
			return name, loc
		}
	}
	if loc, err := time.LoadLocation(defaultTimeZone); err == nil {
		return defaultTimeZone, loc
	}
	// Sem tzdata no sistema: Brasília não tem horário de verão desde 2019.
	return defaultTimeZone, time.FixedZone(defaultTimeZone, -3*60*60)
}

// localDate é o dia do calendário de t no fuso loc, como meia-noite UTC —
// a mesma forma em que o pgx devolve uma coluna `date`.
func localDate(t time.Time, loc *time.Location) time.Time {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
