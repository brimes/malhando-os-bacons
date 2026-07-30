-- O plano nutricional deixa de ser quatro números digitados na mão: ganha uma
-- justificativa, um método de criação (espelhando training_plans.creation_method)
-- e, quando gerado a partir do plano de treino, o vínculo com ele.
ALTER TABLE nutrition_plans
ADD COLUMN IF NOT EXISTS rationale        TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS creation_method  TEXT NOT NULL DEFAULT 'manual'
    CHECK (creation_method IN ('manual', 'automatic')),
ADD COLUMN IF NOT EXISTS training_plan_id BIGINT REFERENCES training_plans(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Um plano ativo por pessoa, garantido pelo banco e não só pela transação do
-- handler (o handler já desativa os outros antes de inserir, mas nada impedia
-- uma corrida de deixar dois ativos).
CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_plans_one_active
ON nutrition_plans (user_id) WHERE active;

-- suggested_at is TEXT ("HH:MM"), not TIME: the app already validates the
-- format in Go, and a plain string sidesteps pgx's TIME wire-type mapping
-- (a Go time.Time carries a date that has no meaning here).
CREATE TABLE IF NOT EXISTS nutrition_plan_meals (
    id           BIGSERIAL PRIMARY KEY,
    plan_id      BIGINT NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
    meal_order   INT NOT NULL,
    meal_type    TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    name         TEXT NOT NULL,
    suggested_at TEXT CHECK (suggested_at IS NULL OR suggested_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    notes        TEXT NOT NULL DEFAULT '',
    UNIQUE (plan_id, meal_order)
);

-- food_item_id é opcional e ON DELETE SET NULL de propósito: a IA sugere
-- alimentos que podem não existir no catálogo, e apagar um alimento pessoal
-- não pode esvaziar o cardápio — food_name sempre carrega o nome por conta própria.
CREATE TABLE IF NOT EXISTS nutrition_plan_meal_items (
    id           BIGSERIAL PRIMARY KEY,
    meal_id      BIGINT NOT NULL REFERENCES nutrition_plan_meals(id) ON DELETE CASCADE,
    item_order   INT NOT NULL,
    food_item_id BIGINT REFERENCES food_items(id) ON DELETE SET NULL,
    food_name    TEXT NOT NULL,
    quantity_g   NUMERIC(8,2) NOT NULL CHECK (quantity_g > 0),
    calories     NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (calories >= 0),
    protein_g    NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
    carbs_g      NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
    fat_g        NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
    UNIQUE (meal_id, item_order)
);
