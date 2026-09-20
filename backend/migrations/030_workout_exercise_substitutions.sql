-- Troca de exercício proposta pelo chat de dúvidas e confirmada com
-- "Trocar só hoje" (scope="session" em POST /workouts/{id}/substitutions).
-- O plano fica intacto: só esta tabela muda, e writeActive
-- (handlers/workout_session.go) faz LEFT JOIN nela por cima de
-- training_plan_exercises para a sessão ativa mostrar o substituto mantendo
-- o id do exercício do plano — é esse id que o app usa para registrar série.
--
-- A outra opção de troca, "Trocar no plano" (scope="plan"), não usa esta
-- tabela: ela faz UPDATE em training_plan_exercises no lugar, pelo mesmo
-- motivo do ajuste de plano (training_plan_adjust.go) — workout_sets referencia
-- essas linhas com ON DELETE SET NULL, então recriar desvincularia o histórico.
--
-- UNIQUE (workout_id, training_plan_exercise_id): trocar de novo o mesmo
-- exercício, na mesma sessão, substitui a troca anterior (UPSERT) em vez de
-- empilhar duas.
CREATE TABLE IF NOT EXISTS workout_exercise_substitutions (
    id                        BIGSERIAL PRIMARY KEY,
    workout_id                BIGINT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    training_plan_exercise_id BIGINT NOT NULL REFERENCES training_plan_exercises(id) ON DELETE CASCADE,
    exercise_name             TEXT NOT NULL,
    sets                      INT NOT NULL,
    reps                      INT NOT NULL,
    tracking_type             TEXT NOT NULL CHECK (tracking_type IN ('reps', 'time')),
    duration_seconds          INT,
    rest_seconds              INT NOT NULL,
    notes                     TEXT NOT NULL DEFAULT '',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workout_id, training_plan_exercise_id)
);
