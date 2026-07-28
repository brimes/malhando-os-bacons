ALTER TABLE users
ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    birth_date     DATE NOT NULL,
    height_cm      NUMERIC(5,2) NOT NULL CHECK (height_cm BETWEEN 50 AND 260),
    current_weight_kg NUMERIC(6,2) NOT NULL CHECK (current_weight_kg BETWEEN 20 AND 500),
    biological_sex TEXT CHECK (biological_sex IN ('female', 'male')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_messages (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_messages_user_id
ON onboarding_messages(user_id, id);

CREATE TABLE IF NOT EXISTS user_goals (
    user_id          BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    goal_type        TEXT NOT NULL CHECK (goal_type IN ('lose_weight', 'gain_muscle', 'recomposition', 'maintain', 'other')),
    target_weight_kg NUMERIC(6,2),
    summary          TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
