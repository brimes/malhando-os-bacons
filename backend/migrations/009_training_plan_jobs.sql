CREATE TABLE IF NOT EXISTS training_plan_jobs (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
    plan_id    BIGINT REFERENCES training_plans(id) ON DELETE SET NULL,
    error      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_plan_jobs_user ON training_plan_jobs(user_id, created_at DESC);
