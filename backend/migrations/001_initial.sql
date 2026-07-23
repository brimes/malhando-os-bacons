-- MOB (Malhando os Bacons) - Initial Schema
-- Migration: 001_initial.sql

BEGIN;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    avatar_url  TEXT,
    google_id   TEXT UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Workouts table
CREATE TABLE IF NOT EXISTS workouts (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workouts_user_id ON workouts(user_id);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);

-- Workout sets table
CREATE TABLE IF NOT EXISTS workout_sets (
    id            BIGSERIAL PRIMARY KEY,
    workout_id    BIGINT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_name TEXT NOT NULL,
    sets          INT NOT NULL DEFAULT 1 CHECK (sets > 0),
    reps          INT NOT NULL DEFAULT 1 CHECK (reps > 0),
    weight_kg     NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_sets_workout_id ON workout_sets(workout_id);
CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise ON workout_sets(exercise_name);

-- Food items table (catalog)
CREATE TABLE IF NOT EXISTS food_items (
    id                BIGSERIAL PRIMARY KEY,
    name              TEXT NOT NULL,
    calories_per_100g NUMERIC(8,2) NOT NULL CHECK (calories_per_100g >= 0),
    protein_g         NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
    carbs_g           NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
    fat_g             NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
    source            TEXT  -- 'taco', 'usda', 'user', etc.
);

CREATE INDEX IF NOT EXISTS idx_food_items_name ON food_items USING gin(to_tsvector('portuguese', name));

-- Nutrition plans table
CREATE TABLE IF NOT EXISTS nutrition_plans (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    calories_target INT NOT NULL CHECK (calories_target > 0),
    protein_target  NUMERIC(6,2) NOT NULL DEFAULT 0,
    carbs_target    NUMERIC(6,2) NOT NULL DEFAULT 0,
    fat_target      NUMERIC(6,2) NOT NULL DEFAULT 0,
    active          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_nutrition_plans_user_id ON nutrition_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_plans_active ON nutrition_plans(user_id, active);

-- Food logs table (daily food tracking)
CREATE TABLE IF NOT EXISTS food_logs (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    food_item_id BIGINT NOT NULL REFERENCES food_items(id),
    meal_type    TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    quantity_g   NUMERIC(8,2) NOT NULL CHECK (quantity_g > 0),
    date         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_logs_user_id ON food_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_food_logs_date ON food_logs(user_id, date);

-- Steps table
CREATE TABLE IF NOT EXISTS steps (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date            DATE NOT NULL DEFAULT CURRENT_DATE,
    count           INT NOT NULL DEFAULT 0 CHECK (count >= 0),
    calories_burned NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (calories_burned >= 0),
    source          TEXT NOT NULL DEFAULT 'galaxy_watch',
    UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_steps_user_id ON steps(user_id);
CREATE INDEX IF NOT EXISTS idx_steps_date ON steps(user_id, date);

-- Seed some common Brazilian foods
INSERT INTO food_items (name, calories_per_100g, protein_g, carbs_g, fat_g, source) VALUES
    ('Arroz branco cozido', 128, 2.5, 28.1, 0.2, 'taco'),
    ('Feijão carioca cozido', 76, 4.8, 13.6, 0.5, 'taco'),
    ('Frango grelhado sem pele', 163, 31.4, 0, 3.6, 'taco'),
    ('Ovo inteiro cozido', 144, 13.0, 0.6, 9.5, 'taco'),
    ('Banana prata', 98, 1.3, 26.0, 0.1, 'taco'),
    ('Batata-doce cozida', 86, 1.3, 20.1, 0.1, 'taco'),
    ('Aveia em flocos', 394, 13.9, 66.6, 8.5, 'taco'),
    ('Peito de peru', 109, 19.5, 0.5, 3.1, 'taco'),
    ('Atum em água', 119, 26.0, 0, 1.5, 'taco'),
    ('Brócolis cozido', 34, 2.9, 4.8, 0.3, 'taco'),
    ('Whey protein (concentrado)', 360, 74.0, 10.0, 4.0, 'user'),
    ('Azeite de oliva', 884, 0, 0, 100.0, 'taco')
ON CONFLICT DO NOTHING;

COMMIT;
