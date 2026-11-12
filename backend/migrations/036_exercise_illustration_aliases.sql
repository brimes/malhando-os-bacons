-- Reaproveitamento de ilustração entre nomes do MESMO exercício
-- ("Cadeira Adutora", "Adutora na Máquina"): em vez de gerar outra imagem, o
-- nome ganha um vínculo para a ilustração que já existe, sem copiar arquivos.
--
-- Como exercise_video_links, é cache global por nome, e a recusa também é
-- gravada (target_name_key NULL, decided_by = 'none'): sem isso, todo pedido do
-- mesmo nome repetiria a pergunta ao assistente.
CREATE TABLE IF NOT EXISTS exercise_illustration_aliases (
    -- Nome normalizado de quem pediu (mesma chave de exercise_illustrations).
    name_key        TEXT PRIMARY KEY,
    -- Ilustração que este nome usa. NULL = "procuramos e nenhuma é equivalente".
    target_name_key TEXT REFERENCES exercise_illustrations(name_key) ON DELETE CASCADE,
    decided_by      TEXT NOT NULL CHECK (decided_by IN ('llm', 'none')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT exercise_illustration_aliases_coerente CHECK (
        (decided_by = 'llm' AND target_name_key IS NOT NULL AND target_name_key <> name_key)
        OR (decided_by = 'none' AND target_name_key IS NULL)
    )
);
