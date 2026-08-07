-- Vínculo entre o nome de exercício que o assistente escreve e o nome do
-- catálogo de vídeos, que é um conjunto fechado de 963 nomes fixos.
--
-- Por que existe: `training_plan_exercises.exercise_name` é texto livre gerado
-- pelo LLM. Medido contra o banco real, 2 de 32 nomes distintos casavam
-- exatamente com o catálogo. Sem esta tabela, praticamente nenhum exercício
-- teria vídeo.
--
-- A chave é o nome, não o exercício nem o usuário: o vocabulário de nomes que
-- o assistente produz é pequeno e se repete entre pessoas e entre planos, então
-- resolver uma vez serve todo mundo para sempre. Isso também faz a tabela valer
-- para `workout_sets.exercise_name` (o histórico) e para os planos que já
-- existiam antes desta migration, sem precisar tocar em nenhuma das duas.
CREATE TABLE IF NOT EXISTS exercise_video_links (
    -- O nome exatamente como foi gravado no plano, em NFC, com acento e caixa
    -- originais. É a chave de junção com exercise_name.
    exercise_name TEXT PRIMARY KEY,

    -- O nome escolhido no catálogo, também byte a byte como está no bucket.
    -- NULL registra uma decisão tomada: "procuramos e não existe vídeo para
    -- isto". Sem essa distinção, todo plano reabriria a busca do zero e pagaria
    -- a chamada ao LLM de novo, para sempre, pelo mesmo nome.
    catalog_name  TEXT,
    object_webm   TEXT,
    object_mp4    TEXT,

    -- Como o vínculo foi decidido: 'exact' (o nome já era do catálogo),
    -- 'llm' (o assistente escolheu entre os candidatos) ou 'none'
    -- (o assistente recusou todos). Serve para reprocessar só o que interessa
    -- quando o casamento melhorar, sem apagar o que foi decidido a dedo.
    resolved_by   TEXT NOT NULL CHECK (resolved_by IN ('exact', 'llm', 'none', 'manual')),

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Ou tem os três campos do catálogo, ou não tem nenhum. Um vínculo com
    -- nome mas sem caminho de objeto faria o app pedir a assinatura de uma
    -- string vazia.
    CONSTRAINT exercise_video_links_completo CHECK (
        (catalog_name IS NULL AND object_webm IS NULL AND object_mp4 IS NULL)
        OR (catalog_name IS NOT NULL AND object_webm IS NOT NULL AND object_mp4 IS NOT NULL)
    )
);

-- Para a tela de espaço no app e para reprocessar por método.
CREATE INDEX IF NOT EXISTS idx_exercise_video_links_resolved
    ON exercise_video_links(resolved_by);
