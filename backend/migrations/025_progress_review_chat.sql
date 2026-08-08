-- O contexto exatamente como o assistente o leu ao produzir a análise.
--
-- Existe por causa do chat: uma pergunta sobre a avaliação ("por que você disse
-- que perdi massa magra?") tem que ser respondida com os mesmos números que
-- geraram aquela frase. Reconstruir o contexto na hora da pergunta traria os
-- dados de hoje, e a conversa passaria a discordar do texto logo acima dela.
ALTER TABLE progress_reviews
ADD COLUMN IF NOT EXISTS context_snapshot TEXT NOT NULL DEFAULT '';

-- Por que não há proposta para aquele plano, quando o assistente disse que
-- havia o que mudar. Sem isto os dois casos — "não há o que mudar" e "havia o
-- que mudar e não deu para montar o plano" — chegam iguais na tela, e ela
-- acabava afirmando que estava tudo bem justamente quando não estava.
-- Vazio significa que não houve falha.
ALTER TABLE progress_reviews
ADD COLUMN IF NOT EXISTS training_proposal_error  TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS nutrition_proposal_error TEXT NOT NULL DEFAULT '';

-- Conversa sobre uma avaliação. Espelha workout_chat_messages (migration 014):
-- uma thread por avaliação, apagada junto com ela.
CREATE TABLE IF NOT EXISTS progress_review_messages (
    id         BIGSERIAL PRIMARY KEY,
    review_id  BIGINT NOT NULL REFERENCES progress_reviews(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progress_review_messages
ON progress_review_messages (review_id, id);
