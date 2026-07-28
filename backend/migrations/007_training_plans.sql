CREATE TABLE IF NOT EXISTS training_plans (
    id                       BIGSERIAL PRIMARY KEY,
    user_id                  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                     TEXT NOT NULL,
    description              TEXT NOT NULL DEFAULT '',
    target_date              DATE NOT NULL,
    days_per_week            INT NOT NULL CHECK (days_per_week BETWEEN 1 AND 7),
    session_duration_minutes INT NOT NULL CHECK (session_duration_minutes BETWEEN 10 AND 240),
    creation_method          TEXT NOT NULL CHECK (creation_method IN ('manual', 'automatic')),
    adaptation_phase         BOOLEAN NOT NULL DEFAULT false,
    active                   BOOLEAN NOT NULL DEFAULT true,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_plans_user ON training_plans(user_id, active);

CREATE TABLE IF NOT EXISTS training_plan_days (
    id           BIGSERIAL PRIMARY KEY,
    plan_id      BIGINT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    day_number   INT NOT NULL CHECK (day_number BETWEEN 1 AND 7),
    name         TEXT NOT NULL,
    focus        TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    UNIQUE (plan_id, day_number)
);

CREATE TABLE IF NOT EXISTS training_plan_exercises (
    id             BIGSERIAL PRIMARY KEY,
    plan_day_id    BIGINT NOT NULL REFERENCES training_plan_days(id) ON DELETE CASCADE,
    exercise_order INT NOT NULL,
    exercise_name  TEXT NOT NULL,
    sets           INT NOT NULL CHECK (sets BETWEEN 1 AND 20),
    reps            INT NOT NULL CHECK (reps BETWEEN 1 AND 100),
    rest_seconds    INT NOT NULL DEFAULT 60 CHECK (rest_seconds BETWEEN 0 AND 600),
    notes           TEXT NOT NULL DEFAULT ''
);

ALTER TABLE workouts
ADD COLUMN IF NOT EXISTS training_plan_day_id BIGINT REFERENCES training_plan_days(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS duration_minutes INT CHECK (duration_minutes BETWEEN 1 AND 600);

CREATE INDEX IF NOT EXISTS idx_workouts_plan_day ON workouts(training_plan_day_id, date DESC);
