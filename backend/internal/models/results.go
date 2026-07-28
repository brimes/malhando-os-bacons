package models

import "time"

// BodyMeasurement is one dated set of readings. Every metric is optional — the
// person logs whatever they measured that day.
type BodyMeasurement struct {
	ID                int64     `json:"id"`
	MeasuredAt        time.Time `json:"measured_at"`
	WeightKg          *float64  `json:"weight_kg,omitempty"`
	BodyFatPercentage *float64  `json:"body_fat_percentage,omitempty"`
	MuscleMassKg      *float64  `json:"muscle_mass_kg,omitempty"`
	WaistCM           *float64  `json:"waist_cm,omitempty"`
	HipCM             *float64  `json:"hip_cm,omitempty"`
	ArmCM             *float64  `json:"arm_cm,omitempty"`
	ThighCM           *float64  `json:"thigh_cm,omitempty"`
	ChestCM           *float64  `json:"chest_cm,omitempty"`
	Notes             string    `json:"notes"`
	CreatedAt         time.Time `json:"created_at"`
}

type SaveBodyMeasurementRequest struct {
	MeasuredAt        string   `json:"measured_at"`
	WeightKg          *float64 `json:"weight_kg"`
	BodyFatPercentage *float64 `json:"body_fat_percentage"`
	MuscleMassKg      *float64 `json:"muscle_mass_kg"`
	WaistCM           *float64 `json:"waist_cm"`
	HipCM             *float64 `json:"hip_cm"`
	ArmCM             *float64 `json:"arm_cm"`
	ThighCM           *float64 `json:"thigh_cm"`
	ChestCM           *float64 `json:"chest_cm"`
	Notes             string   `json:"notes"`
}

// MetricSeries is one indicator over time, already paired with its goal so the
// screen does not have to cross-reference user_goals itself.
type MetricSeries struct {
	Key    string        `json:"key"`
	Label  string        `json:"label"`
	Unit   string        `json:"unit"`
	Target *float64      `json:"target,omitempty"`
	Points []MetricPoint `json:"points"`
}

type MetricPoint struct {
	Date  time.Time `json:"date"`
	Value float64   `json:"value"`
}

type ResultsResponse struct {
	Measurements []BodyMeasurement   `json:"measurements"`
	Series       []MetricSeries      `json:"series"`
	Conditioning []FitnessAssessment `json:"conditioning"`
}

// NextWorkout is the plan day the person should train next: the one done
// longest ago, never-done first, ties broken by the order it was registered.
type NextWorkout struct {
	PlanID     int64      `json:"plan_id"`
	PlanName   string     `json:"plan_name"`
	DayID      int64      `json:"day_id"`
	DayName    string     `json:"day_name"`
	Focus      string     `json:"focus"`
	LastDoneAt *time.Time `json:"last_done_at,omitempty"`
}

// WeeklyPerformance compares the current week against the active plan's target.
type WeeklyPerformance struct {
	PlanName       string `json:"plan_name"`
	TargetPerWeek  int    `json:"target_per_week"`
	DoneThisWeek   int    `json:"done_this_week"`
	Remaining      int    `json:"remaining"`
	DaysLeftInWeek int    `json:"days_left_in_week"`
	// OnTrack means the weekly target is already met.
	OnTrack bool `json:"on_track"`
	// StillPossible is false once there are fewer days left than workouts missing.
	StillPossible bool `json:"still_possible"`
}
