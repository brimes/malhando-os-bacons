-- Ilustrações geradas por IA para exercícios que ficaram sem vídeo.
--
-- Complementa exercise_video_links: quando o associador recusa todos os
-- candidatos do catálogo (resolved_by = 'none'), o app oferece gerar uma
-- ilustração. Como o vínculo de vídeo, o cache é GLOBAL por nome: gerar uma vez
-- serve todo mundo, e a imagem custa uma chamada de IA só.
CREATE TABLE IF NOT EXISTS exercise_illustrations (
    -- Nome normalizado (minúsculas, espaços colapsados). A PK é o que impede
    -- duas gerações do mesmo exercício: a segunda requisição encontra a linha
    -- e reaproveita em vez de pagar outra imagem.
    name_key      TEXT PRIMARY KEY,
    -- Nome como foi pedido, para o prompt e para depuração.
    exercise_name TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
    -- Relativo a PhotoDir/exercise-illustrations/. NULL enquanto não está pronta.
    storage_path  TEXT,
    content_type  TEXT,
    error         TEXT,
    requested_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT exercise_illustrations_pronta CHECK (
        status <> 'ready' OR (storage_path IS NOT NULL AND content_type IS NOT NULL)
    )
);

-- Cada geração iniciada por alguém, para o limite diário por usuário.
CREATE TABLE IF NOT EXISTS exercise_illustration_requests (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name_key   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercise_illustration_requests_user_day
    ON exercise_illustration_requests(user_id, created_at);
