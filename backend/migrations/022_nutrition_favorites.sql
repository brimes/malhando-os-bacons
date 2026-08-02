-- Um favorito guarda os padrões do último registro (quantidade, refeição,
-- macros), não uma referência viva ao alimento — mesma decisão de food_logs
-- (018) e pelo mesmo motivo: corrigir o alimento no catálogo depois não pode
-- reescrever o que a pessoa memorizou. Uma linha por alimento (group_key),
-- nunca por combinação com refeição — favoritar "ovo" não deveria virar "ovo
-- no café" e "ovo no jantar" espalhados pela lista.
CREATE TABLE IF NOT EXISTS nutrition_favorites (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'item:<food_items.id>' ou 'name:<nome normalizado>' — ver
    -- normalizeSearchText (Go) e o translate() da migration 017 (SQL), escritos
    -- de propósito para coincidir.
    group_key    TEXT NOT NULL,
    food_item_id BIGINT REFERENCES food_items(id) ON DELETE SET NULL,
    food_name    TEXT NOT NULL,
    quantity_g   NUMERIC(8,2) NOT NULL CHECK (quantity_g > 0),
    meal_type    TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    calories     NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (calories >= 0),
    protein_g    NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
    carbs_g      NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
    fat_g        NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, group_key)
);
