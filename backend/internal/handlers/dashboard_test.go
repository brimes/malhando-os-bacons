package handlers

import (
	"testing"
	"time"
)

func TestDaysLeftInWeek(t *testing.T) {
	date := func(y int, m time.Month, d int) time.Time {
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	}

	cases := []struct {
		name         string
		today        time.Time
		trainedToday bool
		want         int
	}{
		{"segunda, sem treino hoje", date(2026, time.August, 3), false, 7},
		{"segunda, com treino hoje", date(2026, time.August, 3), true, 6},
		{"terca, sem treino hoje", date(2026, time.August, 4), false, 6},
		{"terca, com treino hoje", date(2026, time.August, 4), true, 5},
		{"quarta, sem treino hoje", date(2026, time.August, 5), false, 5},
		{"quinta, sem treino hoje", date(2026, time.August, 6), false, 4},
		{"sexta, sem treino hoje", date(2026, time.August, 7), false, 3},
		{"sabado, sem treino hoje", date(2026, time.August, 8), false, 2},
		{"sabado, com treino hoje", date(2026, time.August, 8), true, 1},
		{"domingo, sem treino hoje", date(2026, time.August, 9), false, 1},
		{"domingo, com treino hoje", date(2026, time.August, 9), true, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := daysLeftInWeek(tc.today, tc.trainedToday)
			if got != tc.want {
				t.Errorf("daysLeftInWeek(%s, trainedToday=%v) = %d, want %d",
					tc.today.Weekday(), tc.trainedToday, got, tc.want)
			}
			if got < 0 {
				t.Errorf("daysLeftInWeek must never be negative, got %d", got)
			}
		})
	}
}
