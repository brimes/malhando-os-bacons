-- Histórico de resultados. Cada linha é uma medição numa data; todos os campos
-- são opcionais porque a pessoa registra só o que tem naquele dia (uma balança
-- de bioimpedância dá gordura e massa magra, uma fita métrica só circunferências).
-- Os três primeiros espelham as metas de user_goals, para comparar com o alvo.
CREATE TABLE IF NOT EXISTS body_measurements (
    id                    BIGSERIAL PRIMARY KEY,
    user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    measured_at           DATE NOT NULL DEFAULT CURRENT_DATE,
    weight_kg             NUMERIC(6,2) CHECK (weight_kg BETWEEN 20 AND 500),
    body_fat_percentage   NUMERIC(5,2) CHECK (body_fat_percentage BETWEEN 1 AND 70),
    muscle_mass_kg        NUMERIC(6,2) CHECK (muscle_mass_kg BETWEEN 5 AND 200),
    waist_cm              NUMERIC(5,2) CHECK (waist_cm BETWEEN 30 AND 250),
    hip_cm                NUMERIC(5,2) CHECK (hip_cm BETWEEN 30 AND 250),
    arm_cm                NUMERIC(5,2) CHECK (arm_cm BETWEEN 10 AND 100),
    thigh_cm              NUMERIC(5,2) CHECK (thigh_cm BETWEEN 20 AND 150),
    chest_cm              NUMERIC(5,2) CHECK (chest_cm BETWEEN 40 AND 250),
    notes                 TEXT NOT NULL DEFAULT '',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Uma medição por dia: registrar de novo no mesmo dia corrige a anterior
    -- em vez de criar duas leituras conflitantes na série histórica.
    UNIQUE (user_id, measured_at)
);

CREATE INDEX IF NOT EXISTS idx_body_measurements_user_date
ON body_measurements(user_id, measured_at DESC);
