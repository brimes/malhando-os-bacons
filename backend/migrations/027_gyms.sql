-- Academias da pessoa, com os aparelhos que ela tem à mão. A geração de plano
-- passa a poder ler isso para só prescrever o que é executável no local
-- escolhido — sem academia nenhuma, o comportamento de hoje continua igual.
CREATE TABLE IF NOT EXISTS gyms (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    notes      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gyms_user_name ON gyms (user_id, name);

CREATE TABLE IF NOT EXISTS gym_equipment (
    id         BIGSERIAL PRIMARY KEY,
    gym_id     BIGINT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (gym_id, name)
);

-- SET NULL de propósito: apagar a academia não pode apagar o plano gerado com
-- ela, só o vínculo. O plano continua valendo, só perde a referência ao local.
ALTER TABLE training_plans
ADD COLUMN IF NOT EXISTS gym_id BIGINT REFERENCES gyms(id) ON DELETE SET NULL;
