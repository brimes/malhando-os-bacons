-- Plano dinâmico: em vez de vir pronto com todos os dias, guarda a
-- configuração e ganha um dia novo a cada pedido, olhando o treino mais
-- recente. `preferences` passa a ser gravado porque até agora só passava pelo
-- prompt e se perdia — o plano dinâmico precisa reaproveitá-lo em toda geração.
ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS preferences TEXT NOT NULL DEFAULT '';

-- Derrubado por busca no catálogo, não pelo nome escrito à mão: `training_plans_kind_check`
-- é o nome que o Postgres dá por padrão, mas se este banco tiver nascido de outro
-- caminho o DROP pelo nome não acharia nada, o ADD passaria, e a constraint velha
-- continuaria recusando 'dynamic' — falha que só apareceria em produção, na hora
-- de criar o primeiro plano dinâmico.
DO $$
DECLARE constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'training_plans'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%kind%'
    LOOP
        EXECUTE format('ALTER TABLE training_plans DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;
ALTER TABLE training_plans ADD CONSTRAINT training_plans_kind_check
    CHECK (kind IN ('regular', 'compensation', 'dynamic'));

-- No plano dinâmico cada geração insere um dia novo no mesmo plano, então o
-- contador passa de 7 rotineiramente. Os outros tipos continuam com no máximo
-- um dia por número graças ao UNIQUE(plan_id, day_number); só o teto de 7 sai.
DO $$
DECLARE constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'training_plan_days'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%day_number%'
    LOOP
        EXECUTE format('ALTER TABLE training_plan_days DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;
ALTER TABLE training_plan_days ADD CONSTRAINT training_plan_days_day_number_check
    CHECK (day_number >= 1);

-- generated_for/generated_at ficam nulos em plano normal e manual; só o dia
-- dinâmico os preenche, para saber "de quando" é aquele dia sem depender de
-- created_at (que a tabela nem tem).
ALTER TABLE training_plan_days ADD COLUMN IF NOT EXISTS generated_for DATE;
ALTER TABLE training_plan_days ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ;

ALTER TABLE training_plan_jobs
ADD COLUMN IF NOT EXISTS plan_day_id BIGINT REFERENCES training_plan_days(id) ON DELETE SET NULL;
