ALTER TABLE user_goals
ADD COLUMN IF NOT EXISTS target_body_fat_percentage NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS target_muscle_mass_kg NUMERIC(6,2),
ADD COLUMN IF NOT EXISTS target_six_minute_walk_meters INT,
ADD COLUMN IF NOT EXISTS conditioning_focus BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS feasibility TEXT NOT NULL DEFAULT 'realistic' CHECK (feasibility IN ('realistic', 'challenging', 'unrealistic')),
ADD COLUMN IF NOT EXISTS feasibility_warning TEXT;

ALTER TABLE onboarding_messages
ADD COLUMN IF NOT EXISTS action TEXT CHECK (action IN ('six_minute_walk', 'confirm_unrealistic_goal'));

CREATE TABLE IF NOT EXISTS fitness_assessments (
    id                 BIGSERIAL PRIMARY KEY,
    user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    test_type          TEXT NOT NULL CHECK (test_type IN ('six_minute_walk')),
    distance_meters    INT NOT NULL CHECK (distance_meters BETWEEN 50 AND 2000),
    average_heart_rate INT CHECK (average_heart_rate BETWEEN 30 AND 240),
    post_heart_rate    INT CHECK (post_heart_rate BETWEEN 30 AND 240),
    perceived_exertion INT NOT NULL CHECK (perceived_exertion BETWEEN 1 AND 10),
    performed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fitness_assessments_user_date
ON fitness_assessments(user_id, performed_at DESC);
