CREATE TABLE IF NOT EXISTS cheat_day_sessions (
    id                   BIGSERIAL PRIMARY KEY,
    user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'accepted', 'discarded')),
    happens_on           DATE NOT NULL,
    estimated_calories   INT,
    summary              TEXT NOT NULL DEFAULT '',
    compensation_plan_id BIGINT REFERENCES training_plans(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cheat_day_user ON cheat_day_sessions (user_id, created_at DESC);

-- Só uma sessão aberta por vez: pedir compensação para vários exageros
-- seguidos não deve empilhar planos de compensação.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cheat_day_one_open
ON cheat_day_sessions (user_id) WHERE status = 'open';

-- Espelha workout_chat_messages (migration 014).
CREATE TABLE IF NOT EXISTS cheat_day_messages (
    id         BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES cheat_day_sessions(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cheat_day_messages ON cheat_day_messages (session_id, id);

-- O treino de compensação é um training_plans próprio, marcado e com validade,
-- em vez de uma entidade paralela: assim Start/CompleteSet/Finish e a sessão
-- guiada funcionam nele sem nenhuma alteração, e o plano real da pessoa nunca
-- é tocado. kind='regular' precisa ser filtrado por toda query que hoje
-- assume "o plano ativo da pessoa" (ver auditoria no plano de implementação).
ALTER TABLE training_plans
ADD COLUMN IF NOT EXISTS kind       TEXT NOT NULL DEFAULT 'regular'
    CHECK (kind IN ('regular', 'compensation')),
ADD COLUMN IF NOT EXISTS expires_at DATE;

CREATE INDEX IF NOT EXISTS idx_training_plans_kind ON training_plans (user_id, kind, active);
