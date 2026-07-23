package services

import (
	"context"
	"fmt"
	"time"

	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/models"
)

type WorkoutService struct {
	db *db.DB
}

func NewWorkoutService(database *db.DB) *WorkoutService {
	return &WorkoutService{db: database}
}

// GetWorkoutsInRange returns workouts for a user in a date range
func (s *WorkoutService) GetWorkoutsInRange(ctx context.Context, userID int64, from, to time.Time) ([]models.Workout, error) {
	rows, err := s.db.Pool.Query(ctx,
		`SELECT id, user_id, name, date, notes, created_at
		 FROM workouts WHERE user_id = $1 AND date BETWEEN $2 AND $3
		 ORDER BY date DESC`,
		userID, from, to,
	)
	if err != nil {
		return nil, fmt.Errorf("query workouts: %w", err)
	}
	defer rows.Close()

	var workouts []models.Workout
	for rows.Next() {
		var w models.Workout
		if err := rows.Scan(&w.ID, &w.UserID, &w.Name, &w.Date, &w.Notes, &w.CreatedAt); err != nil {
			return nil, err
		}
		workouts = append(workouts, w)
	}
	return workouts, nil
}

// GetFrequencyByWeek returns the count of workouts per week for the last N weeks
func (s *WorkoutService) GetFrequencyByWeek(ctx context.Context, userID int64, weeks int) (map[string]int, error) {
	from := time.Now().AddDate(0, 0, -weeks*7)

	rows, err := s.db.Pool.Query(ctx,
		`SELECT to_char(date_trunc('week', date), 'YYYY-WW') as week, COUNT(*) as count
		 FROM workouts WHERE user_id = $1 AND date >= $2
		 GROUP BY week ORDER BY week`,
		userID, from,
	)
	if err != nil {
		return nil, fmt.Errorf("query frequency: %w", err)
	}
	defer rows.Close()

	result := make(map[string]int)
	for rows.Next() {
		var week string
		var count int
		if err := rows.Scan(&week, &count); err != nil {
			return nil, err
		}
		result[week] = count
	}
	return result, nil
}

// GetPersonalRecords returns the maximum weight lifted per exercise
func (s *WorkoutService) GetPersonalRecords(ctx context.Context, userID int64) (map[string]float64, error) {
	rows, err := s.db.Pool.Query(ctx,
		`SELECT ws.exercise_name, MAX(ws.weight_kg) as max_weight
		 FROM workout_sets ws
		 JOIN workouts w ON w.id = ws.workout_id
		 WHERE w.user_id = $1
		 GROUP BY ws.exercise_name
		 ORDER BY max_weight DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("query personal records: %w", err)
	}
	defer rows.Close()

	records := make(map[string]float64)
	for rows.Next() {
		var exercise string
		var maxWeight float64
		if err := rows.Scan(&exercise, &maxWeight); err != nil {
			return nil, err
		}
		records[exercise] = maxWeight
	}
	return records, nil
}

// GetMostFrequentExercises returns the most trained exercises
func (s *WorkoutService) GetMostFrequentExercises(ctx context.Context, userID int64, limit int) ([]string, error) {
	rows, err := s.db.Pool.Query(ctx,
		`SELECT ws.exercise_name
		 FROM workout_sets ws
		 JOIN workouts w ON w.id = ws.workout_id
		 WHERE w.user_id = $1
		 GROUP BY ws.exercise_name
		 ORDER BY COUNT(*) DESC
		 LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query exercises: %w", err)
	}
	defer rows.Close()

	var exercises []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		exercises = append(exercises, name)
	}
	return exercises, nil
}
