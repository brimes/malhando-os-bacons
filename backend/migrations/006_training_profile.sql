ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS injuries_or_limitations TEXT,
ADD COLUMN IF NOT EXISTS training_experience TEXT CHECK (training_experience IN ('beginner', 'experienced')),
ADD COLUMN IF NOT EXISTS adaptation_ends_at DATE;
