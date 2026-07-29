-- Conversa de dúvidas durante o treino. Cada treino tem a sua própria thread,
-- então apagar o treino apaga o histórico junto (ON DELETE CASCADE).
-- user_id é redundante com workouts.user_id, mas evita um JOIN só para listar.
CREATE TABLE IF NOT EXISTS workout_chat_messages (
    id         BIGSERIAL PRIMARY KEY,
    workout_id BIGINT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_chat_messages_workout
ON workout_chat_messages(workout_id, id);
