-- Espelha training_plan_jobs (migration 009): a geração/ajuste do plano
-- nutricional roda em goroutine detached pela mesma razão — o assistente leva
-- minutos, muito mais do que uma requisição pode segurar sem estourar o
-- WriteTimeout do servidor e virar 500 no proxy.
CREATE TABLE IF NOT EXISTS nutrition_plan_jobs (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'generate' CHECK (kind IN ('generate', 'adjust')),
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
    plan_id    BIGINT REFERENCES nutrition_plans(id) ON DELETE SET NULL,
    error      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nutrition_plan_jobs_user
ON nutrition_plan_jobs (user_id, created_at DESC);

-- Metadados das fotos guardadas no PVC (backend/internal/config PhotoDir).
-- Os dois FKs são ON DELETE SET NULL de propósito: apagar o registro do diário
-- ou o alimento não pode apagar esta linha, senão o arquivo em disco vira
-- órfão sem ninguém saber que existe — a linha é o inventário do que está no
-- disco, e uma varredura periódica usa quem ficou com os dois FKs nulos para
-- decidir o que remover.
CREATE TABLE IF NOT EXISTS meal_photos (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    food_log_id  BIGINT REFERENCES food_logs(id) ON DELETE SET NULL,
    food_item_id BIGINT REFERENCES food_items(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('plate', 'label')),
    storage_path TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    byte_size    INT NOT NULL CHECK (byte_size > 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meal_photos_user ON meal_photos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meal_photos_log  ON meal_photos (food_log_id);
CREATE INDEX IF NOT EXISTS idx_meal_photos_food ON meal_photos (food_item_id);
