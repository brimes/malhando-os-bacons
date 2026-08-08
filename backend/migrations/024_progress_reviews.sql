-- Avaliação do resultado: o assistente lê todo o histórico do período (treinos
-- executados, alimentação registrada, medições) e compara com o objetivo.
--
-- A linha É o job. Gerar a avaliação leva minutos (uma chamada de análise mais,
-- quando há mudança a propor, uma chamada de ajuste por plano), então o
-- endpoint responde 202 e a tela faz polling — mesmo contrato de
-- training_plan_jobs e nutrition_plan_jobs. Uma tabela de job separada só
-- duplicaria o estado: aqui não existe avaliação sem o job que a produziu, nem
-- job cujo resultado não seja a avaliação.
CREATE TABLE IF NOT EXISTS progress_reviews (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- pending: análise rodando. ready: análise pronta, com ou sem proposta de
    -- mudança. applied: a pessoa confirmou e os planos foram atualizados.
    -- discarded: a pessoa recusou a mudança (a análise continua legível).
    -- failed: o assistente não respondeu; `error` diz o quê.
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'ready', 'applied', 'discarded', 'failed')),

    period_start DATE NOT NULL,
    period_end   DATE NOT NULL,

    -- Os dois tópicos obrigatórios da avaliação.
    performance     TEXT NOT NULL DEFAULT '',
    goal_assessment TEXT NOT NULL DEFAULT '',
    goal_status     TEXT NOT NULL DEFAULT 'on_track'
                    CHECK (goal_status IN ('on_track', 'needs_change', 'at_risk')),

    -- Terceiro tópico, opcional: a proposta concreta de plano já pronta, não um
    -- pedido em texto para ser gerado depois. O que a pessoa confirma na tela
    -- tem que ser exatamente o que vai para o banco; gerar o plano só na hora
    -- do "confirmar" deixaria o resultado livre para divergir do que foi lido.
    -- NULL = nada a mudar naquele plano.
    training_plan_id    BIGINT REFERENCES training_plans(id) ON DELETE SET NULL,
    training_summary    TEXT NOT NULL DEFAULT '',
    training_proposal   JSONB,
    nutrition_plan_id   BIGINT REFERENCES nutrition_plans(id) ON DELETE SET NULL,
    nutrition_summary   TEXT NOT NULL DEFAULT '',
    nutrition_proposal  JSONB,

    -- O que de fato foi aplicado quando a pessoa confirmou: ela pode aceitar só
    -- a mudança de treino, só a de nutrição, ou as duas.
    applied_training  BOOLEAN NOT NULL DEFAULT false,
    applied_nutrition BOOLEAN NOT NULL DEFAULT false,

    error        TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_progress_reviews_user
ON progress_reviews (user_id, created_at DESC);

-- Uma avaliação em andamento por vez. Cada avaliação são várias chamadas caras
-- ao LLM; tocar o botão duas vezes não pode disparar duas análises paralelas
-- que depois brigam para aplicar propostas diferentes no mesmo plano.
CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_reviews_one_pending
ON progress_reviews (user_id) WHERE status = 'pending';

-- O plano como estava imediatamente antes de a avaliação alterá-lo.
--
-- Aplicar a proposta reconcilia o plano no lugar (applyAdjustment /
-- applyNutritionAdjustment), justamente para não desvincular o histórico de
-- treinos e séries — ou seja, a versão anterior deixa de existir nas tabelas de
-- plano. Este snapshot é onde ela passa a viver, para análise posterior:
-- é uma cópia em JSON, não uma referência, então continua legível mesmo depois
-- de o plano ser excluído.
CREATE TABLE IF NOT EXISTS plan_revisions (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_id  BIGINT REFERENCES progress_reviews(id) ON DELETE SET NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('training', 'nutrition')),
    -- Sem FK: o snapshot precisa sobreviver à exclusão do plano que descreve.
    plan_id    BIGINT,
    plan_name  TEXT NOT NULL DEFAULT '',
    snapshot   JSONB NOT NULL,
    reason     TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_revisions_user
ON plan_revisions (user_id, kind, created_at DESC);
