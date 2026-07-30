-- Alimentos deixam de ser só um catálogo global de 12 linhas: user_id nulo
-- continua sendo o catálogo compartilhado, e um user_id preenchido é um
-- alimento pessoal (cadastrado à mão ou por foto).
ALTER TABLE food_items
ADD COLUMN IF NOT EXISTS user_id       BIGINT REFERENCES users(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS brand         TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS serving_label TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS serving_grams NUMERIC(8,2) CHECK (serving_grams > 0),
ADD COLUMN IF NOT EXISTS fiber_g       NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (fiber_g >= 0),
ADD COLUMN IF NOT EXISTS sodium_mg     NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (sodium_mg >= 0),
ADD COLUMN IF NOT EXISTS search_text   TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS archived      BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Nunca foi usado: a busca sempre foi ILIKE, não to_tsvector.
DROP INDEX IF EXISTS idx_food_items_name;

-- search_text carrega o nome (e a marca) já sem acento, em minúsculas, para a
-- aplicação buscar com LIKE simples em vez de repetir translate() em SQL.
UPDATE food_items
SET search_text = lower(
    translate(trim(name || ' ' || brand),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')
)
WHERE search_text = '';

-- Um nome por dono: o catálogo global (user_id nulo) é tratado como "um dono só"
-- por NULLS NOT DISTINCT (Postgres 16, confirmado em produção e em dev).
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_items_owner_name
ON food_items (user_id, lower(name), lower(brand)) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_food_items_search ON food_items (search_text);
CREATE INDEX IF NOT EXISTS idx_food_items_user   ON food_items (user_id) WHERE user_id IS NOT NULL;
