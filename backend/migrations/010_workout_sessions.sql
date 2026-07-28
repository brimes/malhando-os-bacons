-- Guided workout sessions: a workout is now created when the user presses start
-- and stays open while the series are executed, so a reload or a locked screen
-- never loses progress.
ALTER TABLE workouts
ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed')),
ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- Only one session may be open per user at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_one_active
ON workouts(user_id) WHERE status = 'in_progress';

-- Each completed series is stored as its own row (sets = 1) so the weight used
-- in that specific series is preserved for history.
ALTER TABLE workout_sets
ADD COLUMN IF NOT EXISTS training_plan_exercise_id BIGINT REFERENCES training_plan_exercises(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS set_number   INT,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workout_sets_plan_exercise
ON workout_sets(training_plan_exercise_id, completed_at DESC);

-- Last weight used, echoed back as the suggestion next time this exercise comes up.
ALTER TABLE training_plan_exercises
ADD COLUMN IF NOT EXISTS last_weight_kg NUMERIC(6,2) CHECK (last_weight_kg >= 0);

-- Guided session preferences.
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS countdown_seconds INT NOT NULL DEFAULT 5 CHECK (countdown_seconds BETWEEN 0 AND 60),
ADD COLUMN IF NOT EXISTS vibration_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS auto_advance      BOOLEAN NOT NULL DEFAULT false;
