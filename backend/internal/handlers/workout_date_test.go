package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

func putDate(t *testing.T, h *WorkoutHandler, userID, workoutID int64, date time.Time) (int, models.Workout) {
	t.Helper()
	body := `{"date":"` + date.UTC().Format(time.RFC3339) + `"}`
	req := httptest.NewRequest(http.MethodPut, "/api/workouts/"+strconv.FormatInt(workoutID, 10)+"/date", strings.NewReader(body))
	req.SetPathValue("id", strconv.FormatInt(workoutID, 10))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	h.UpdateDate(rec, req)
	var w models.Workout
	_ = json.NewDecoder(rec.Body).Decode(&w)
	return rec.Code, w
}

func seedCompleted(t *testing.T, d *db.DB, userID int64, start time.Time, minutes int) int64 {
	t.Helper()
	var id int64
	if err := d.Pool.QueryRow(context.Background(),
		`INSERT INTO workouts (user_id, name, date, status, started_at, finished_at, duration_minutes)
		 VALUES ($1, 'Treino A', $2, 'completed', $2, $3, $4) RETURNING id`,
		userID, start, start.Add(time.Duration(minutes)*time.Minute), minutes).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestUpdateWorkoutDate(t *testing.T) {
	d := testDB(t)
	h := NewWorkoutHandler(d)
	owner := newUser(t, d, "data-dono@test.local", false)
	other := newUser(t, d, "data-outro@test.local", false)
	now := time.Now()

	yesterday := now.Add(-26 * time.Hour).Truncate(time.Second)
	id := seedCompleted(t, d, owner, yesterday, 50)

	t.Run("dono, duração preservada e date/started/finished deslocados", func(t *testing.T) {
		target := now.Add(-72 * time.Hour).Truncate(time.Second)
		code, w := putDate(t, h, owner, id, target)
		if code != http.StatusOK {
			t.Fatalf("status %d", code)
		}
		if !w.Date.Equal(target) || !w.StartedAt.Equal(target) {
			t.Errorf("date=%v started=%v, want %v", w.Date, w.StartedAt, target)
		}
		if got := w.FinishedAt.Sub(*w.StartedAt); got != 50*time.Minute {
			t.Errorf("duração = %v, want 50m", got)
		}
		if w.DurationMinutes == nil || *w.DurationMinutes != 50 {
			t.Errorf("duration_minutes alterado: %v", w.DurationMinutes)
		}
	})

	t.Run("futuro é rejeitado e nada muda", func(t *testing.T) {
		before := time.Time{}
		_ = d.Pool.QueryRow(context.Background(), `SELECT date FROM workouts WHERE id=$1`, id).Scan(&before)
		code, _ := putDate(t, h, owner, id, now.Add(2*time.Hour))
		if code != http.StatusBadRequest {
			t.Fatalf("status %d, want 400", code)
		}
		var after time.Time
		_ = d.Pool.QueryRow(context.Background(), `SELECT date FROM workouts WHERE id=$1`, id).Scan(&after)
		if !before.Equal(after) {
			t.Error("data mudou apesar da recusa")
		}
	})

	t.Run("outro usuário recebe 404", func(t *testing.T) {
		code, _ := putDate(t, h, other, id, now.Add(-time.Hour))
		if code != http.StatusNotFound {
			t.Fatalf("status %d, want 404", code)
		}
	})

	t.Run("treino em andamento não muda de data", func(t *testing.T) {
		var open int64
		if err := d.Pool.QueryRow(context.Background(),
			`INSERT INTO workouts (user_id, name, date, status, started_at) VALUES ($1,'Aberto',NOW(),'in_progress',NOW()) RETURNING id`,
			owner).Scan(&open); err != nil {
			t.Fatal(err)
		}
		if code, _ := putDate(t, h, owner, open, now.Add(-time.Hour)); code != http.StatusNotFound {
			t.Fatalf("status %d, want 404", code)
		}
		d.Pool.Exec(context.Background(), `DELETE FROM workouts WHERE id=$1`, open)
	})

	t.Run("fim nunca fica no futuro", func(t *testing.T) {
		id2 := seedCompleted(t, d, owner, now.Add(-3*time.Hour).Truncate(time.Second), 120)
		start := now.Add(-10 * time.Minute)
		code, w := putDate(t, h, owner, id2, start)
		if code != http.StatusOK {
			t.Fatalf("status %d", code)
		}
		if w.FinishedAt.After(time.Now().Add(time.Second)) {
			t.Errorf("finished_at no futuro: %v", w.FinishedAt)
		}
	})

	t.Run("last_done_at e semana refletem a nova data", func(t *testing.T) {
		var planID, dayID int64
		if err := d.Pool.QueryRow(context.Background(),
			`INSERT INTO training_plans (user_id, name, target_date, days_per_week, session_duration_minutes, creation_method, active)
			 VALUES ($1,'P',CURRENT_DATE,3,60,'manual',true) RETURNING id`, owner).Scan(&planID); err != nil {
			t.Fatal(err)
		}
		if err := d.Pool.QueryRow(context.Background(),
			`INSERT INTO training_plan_days (plan_id, day_number, name) VALUES ($1,1,'Dia 1') RETURNING id`, planID).Scan(&dayID); err != nil {
			t.Fatal(err)
		}
		long := now.AddDate(0, 0, -40).Truncate(time.Second)
		wid := seedCompleted(t, d, owner, long, 30)
		d.Pool.Exec(context.Background(), `UPDATE workouts SET training_plan_day_id=$2 WHERE id=$1`, wid, dayID)

		lastDone := func() time.Time {
			var t0 time.Time
			d.Pool.QueryRow(context.Background(),
				`SELECT MAX(w.date) FROM training_plan_days d LEFT JOIN workouts w ON w.training_plan_day_id=d.id AND w.status='completed' WHERE d.id=$1`, dayID).Scan(&t0)
			return t0
		}
		weekCount := func() int {
			var n int
			d.Pool.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM workouts WHERE user_id=$1 AND status='completed' AND date >= date_trunc('week', CURRENT_DATE) AND training_plan_day_id=$2`, owner, dayID).Scan(&n)
			return n
		}
		if weekCount() != 0 {
			t.Fatal("pré-condição: fora da semana")
		}
		target := now.Add(-time.Minute).Truncate(time.Second)
		if code, _ := putDate(t, h, owner, wid, target); code != http.StatusOK {
			t.Fatalf("status %d", code)
		}
		if !lastDone().Equal(target) {
			t.Errorf("last_done_at = %v, want %v", lastDone(), target)
		}
		if weekCount() != 1 {
			t.Errorf("semana = %d, want 1", weekCount())
		}
	})
}

func TestCloseWorkoutUsesGivenFinish(t *testing.T) {
	d := testDB(t)
	owner := newUser(t, d, "data-fim@test.local", false)
	start := time.Now().Add(-30 * time.Hour).Truncate(time.Second)
	var id int64
	if err := d.Pool.QueryRow(context.Background(),
		`INSERT INTO workouts (user_id, name, date, status, started_at) VALUES ($1,'Esquecido',$2,'in_progress',$2) RETURNING id`,
		owner, start).Scan(&id); err != nil {
		t.Fatal(err)
	}
	fin := start.Add(55 * time.Minute)
	w, err := closeWorkout(context.Background(), d.Pool, id, owner, "", &fin)
	if err != nil {
		t.Fatal(err)
	}
	if !w.FinishedAt.Equal(fin) || w.DurationMinutes == nil || *w.DurationMinutes != 55 {
		t.Errorf("finished=%v duration=%v", w.FinishedAt, w.DurationMinutes)
	}
}
