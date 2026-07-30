-- Os macros deixam de ser recalculados na leitura a partir da linha viva de
-- food_items: eram (calories_per_100g * quantity_g / 100) computados a cada
-- GET, então corrigir um alimento reescrevia todo o histórico de quem já
-- havia registrado. Agora o valor do momento do registro é gravado aqui,
-- exatamente como workout_sets guarda o peso usado e não uma referência viva.
ALTER TABLE food_logs
ADD COLUMN IF NOT EXISTS food_name     TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS calories      NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (calories >= 0),
ADD COLUMN IF NOT EXISTS protein_g     NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
ADD COLUMN IF NOT EXISTS carbs_g       NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
ADD COLUMN IF NOT EXISTS fat_g         NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
ADD COLUMN IF NOT EXISTS client_log_id TEXT,
ADD COLUMN IF NOT EXISTS origin        TEXT NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual', 'plan', 'photo_plate', 'photo_label', 'cheat_day')),
ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill dos registros existentes a partir do alimento referenciado, antes
-- de food_item_id se tornar opcional (um registro por foto não tem catálogo).
UPDATE food_logs l SET
  food_name = f.name,
  calories  = round((f.calories_per_100g * l.quantity_g / 100.0)::numeric, 2),
  protein_g = round((f.protein_g         * l.quantity_g / 100.0)::numeric, 2),
  carbs_g   = round((f.carbs_g           * l.quantity_g / 100.0)::numeric, 2),
  fat_g     = round((f.fat_g             * l.quantity_g / 100.0)::numeric, 2)
FROM food_items f
WHERE f.id = l.food_item_id AND l.food_name = '';

ALTER TABLE food_logs ALTER COLUMN food_item_id DROP NOT NULL;

-- POST /nutrition/logs já é enfileirado pela fila offline (não está em
-- ONLINE_ONLY_PATHS) e até aqui food_logs não tinha chave de idempotência —
-- diferente de workout_sets.client_set_id (migration 016). Um replay do envio
-- duplicava o registro em silêncio. Mesmo padrão, mesma correção.
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_logs_client_id
ON food_logs (user_id, client_log_id) WHERE client_log_id IS NOT NULL;
