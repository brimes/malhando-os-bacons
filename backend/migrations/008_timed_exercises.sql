ALTER TABLE training_plan_exercises
ADD COLUMN IF NOT EXISTS tracking_type TEXT NOT NULL DEFAULT 'reps' CHECK (tracking_type IN ('reps', 'time')),
ADD COLUMN IF NOT EXISTS duration_seconds INT CHECK (duration_seconds BETWEEN 1 AND 7200);

ALTER TABLE workout_sets
ADD COLUMN IF NOT EXISTS tracking_type TEXT NOT NULL DEFAULT 'reps' CHECK (tracking_type IN ('reps', 'time')),
ADD COLUMN IF NOT EXISTS duration_seconds INT CHECK (duration_seconds BETWEEN 1 AND 7200);
