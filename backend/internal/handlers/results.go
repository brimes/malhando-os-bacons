package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/mob/backend/internal/db"
	"github.com/mob/backend/internal/middleware"
	"github.com/mob/backend/internal/models"
)

type ResultsHandler struct {
	db *db.DB
}

func NewResultsHandler(database *db.DB) *ResultsHandler {
	return &ResultsHandler{db: database}
}

const measurementColumns = `id, measured_at, weight_kg, body_fat_percentage, muscle_mass_kg,
	 waist_cm, hip_cm, arm_cm, thigh_cm, chest_cm, notes, created_at`

func scanMeasurement(row pgx.Row, m *models.BodyMeasurement) error {
	return row.Scan(&m.ID, &m.MeasuredAt, &m.WeightKg, &m.BodyFatPercentage, &m.MuscleMassKg,
		&m.WaistCM, &m.HipCM, &m.ArmCM, &m.ThighCM, &m.ChestCM, &m.Notes, &m.CreatedAt)
}

// List returns the whole history plus per-indicator series paired with the goal
// targets, so the screen can plot progress without a second round trip.
func (h *ResultsHandler) List(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT `+measurementColumns+` FROM body_measurements
		 WHERE user_id = $1 ORDER BY measured_at DESC`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load measurements"})
		return
	}
	defer rows.Close()

	response := models.ResultsResponse{
		Measurements: []models.BodyMeasurement{},
		Conditioning: []models.FitnessAssessment{},
	}
	for rows.Next() {
		var measurement models.BodyMeasurement
		if err := scanMeasurement(rows, &measurement); err == nil {
			response.Measurements = append(response.Measurements, measurement)
		}
	}

	var targetWeight, targetBodyFat, targetMuscle *float64
	_ = h.db.Pool.QueryRow(r.Context(),
		`SELECT target_weight_kg, target_body_fat_percentage, target_muscle_mass_kg
		 FROM user_goals WHERE user_id = $1`, userID).Scan(&targetWeight, &targetBodyFat, &targetMuscle)

	// Series run oldest-first so a chart can render them directly.
	pick := func(get func(models.BodyMeasurement) *float64) []models.MetricPoint {
		points := []models.MetricPoint{}
		for i := len(response.Measurements) - 1; i >= 0; i-- {
			if value := get(response.Measurements[i]); value != nil {
				points = append(points, models.MetricPoint{Date: response.Measurements[i].MeasuredAt, Value: *value})
			}
		}
		return points
	}
	for _, series := range []models.MetricSeries{
		{Key: "weight_kg", Label: "Peso", Unit: "kg", Target: targetWeight,
			Points: pick(func(m models.BodyMeasurement) *float64 { return m.WeightKg })},
		{Key: "body_fat_percentage", Label: "Gordura corporal", Unit: "%", Target: targetBodyFat,
			Points: pick(func(m models.BodyMeasurement) *float64 { return m.BodyFatPercentage })},
		{Key: "muscle_mass_kg", Label: "Massa muscular", Unit: "kg", Target: targetMuscle,
			Points: pick(func(m models.BodyMeasurement) *float64 { return m.MuscleMassKg })},
		{Key: "waist_cm", Label: "Cintura", Unit: "cm",
			Points: pick(func(m models.BodyMeasurement) *float64 { return m.WaistCM })},
		{Key: "hip_cm", Label: "Quadril", Unit: "cm",
			Points: pick(func(m models.BodyMeasurement) *float64 { return m.HipCM })},
		{Key: "arm_cm", Label: "Braço", Unit: "cm",
			Points: pick(func(m models.BodyMeasurement) *float64 { return m.ArmCM })},
		{Key: "thigh_cm", Label: "Coxa", Unit: "cm",
			Points: pick(func(m models.BodyMeasurement) *float64 { return m.ThighCM })},
		{Key: "chest_cm", Label: "Peito", Unit: "cm",
			Points: pick(func(m models.BodyMeasurement) *float64 { return m.ChestCM })},
	} {
		if len(series.Points) > 0 {
			response.Series = append(response.Series, series)
		}
	}
	if response.Series == nil {
		response.Series = []models.MetricSeries{}
	}

	// Conditioning stays in fitness_assessments — the 6-minute walk has its own
	// flow and fields, and duplicating it here would let the two diverge.
	assessmentRows, err := h.db.Pool.Query(r.Context(),
		`SELECT distance_meters, average_heart_rate, post_heart_rate, perceived_exertion, performed_at
		 FROM fitness_assessments WHERE user_id = $1 ORDER BY performed_at DESC`, userID)
	if err == nil {
		defer assessmentRows.Close()
		for assessmentRows.Next() {
			var assessment models.FitnessAssessment
			if err := assessmentRows.Scan(&assessment.DistanceMeters, &assessment.AverageHeartRate,
				&assessment.PostHeartRate, &assessment.PerceivedExertion, &assessment.PerformedAt); err == nil {
				response.Conditioning = append(response.Conditioning, assessment)
			}
		}
	}

	writeJSON(w, http.StatusOK, response)
}

// Save upserts the reading for a date. Re-saving the same day corrects it
// instead of adding a second, conflicting point to the series.
func (h *ResultsHandler) Save(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	var req models.SaveBodyMeasurementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	measuredAt := time.Now()
	if date := strings.TrimSpace(req.MeasuredAt); date != "" {
		// Aceita tanto "2026-07-28" quanto um ISO completo vindo do input date.
		if len(date) > 10 {
			date = date[:10]
		}
		parsed, err := time.Parse("2006-01-02", date)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "measured_at must be YYYY-MM-DD"})
			return
		}
		measuredAt = parsed
	}
	if measuredAt.After(time.Now().AddDate(0, 0, 1)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "measured_at cannot be in the future"})
		return
	}
	values := []*float64{req.WeightKg, req.BodyFatPercentage, req.MuscleMassKg,
		req.WaistCM, req.HipCM, req.ArmCM, req.ThighCM, req.ChestCM}
	filled := false
	for _, value := range values {
		if value != nil {
			filled = true
			break
		}
	}
	if !filled {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "preencha pelo menos um indicador"})
		return
	}

	var measurement models.BodyMeasurement
	err := scanMeasurement(h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO body_measurements (user_id, measured_at, weight_kg, body_fat_percentage,
		 muscle_mass_kg, waist_cm, hip_cm, arm_cm, thigh_cm, chest_cm, notes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		 ON CONFLICT (user_id, measured_at) DO UPDATE SET
		   weight_kg = EXCLUDED.weight_kg,
		   body_fat_percentage = EXCLUDED.body_fat_percentage,
		   muscle_mass_kg = EXCLUDED.muscle_mass_kg,
		   waist_cm = EXCLUDED.waist_cm,
		   hip_cm = EXCLUDED.hip_cm,
		   arm_cm = EXCLUDED.arm_cm,
		   thigh_cm = EXCLUDED.thigh_cm,
		   chest_cm = EXCLUDED.chest_cm,
		   notes = EXCLUDED.notes
		 RETURNING `+measurementColumns,
		userID, measuredAt, req.WeightKg, req.BodyFatPercentage, req.MuscleMassKg,
		req.WaistCM, req.HipCM, req.ArmCM, req.ThighCM, req.ChestCM, strings.TrimSpace(req.Notes),
	), &measurement)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "valores fora dos limites aceitos"})
		return
	}

	// Weight also feeds the profile, which the plan assistant reads as context.
	if req.WeightKg != nil {
		_, _ = h.db.Pool.Exec(r.Context(),
			`UPDATE user_profiles SET current_weight_kg = $2, updated_at = NOW()
			 WHERE user_id = $1 AND $2 > 0`, userID, *req.WeightKg)
	}
	writeJSON(w, http.StatusCreated, measurement)
}

func (h *ResultsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r.Context())
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid measurement id"})
		return
	}
	result, err := h.db.Pool.Exec(r.Context(),
		`DELETE FROM body_measurements WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete measurement"})
		return
	}
	if result.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "measurement not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "measurement deleted"})
}
