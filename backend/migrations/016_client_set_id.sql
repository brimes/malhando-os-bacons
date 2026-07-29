-- Offline set logging: CompleteSet derives set_number itself (never trusts the
-- client's number), so a replayed POST used to be silently accepted as "the
-- next legitimate series" instead of being recognised as a duplicate. The app
-- now mints a client_set_id before the request goes out and queues it if the
-- network drops after the server wrote the row but before the response
-- arrived, so the server must be able to recognise a replay by this key.
ALTER TABLE workout_sets
ADD COLUMN IF NOT EXISTS client_set_id TEXT;

-- Uniqueness is per workout: two different sessions (or two different users)
-- may mint the same id without colliding. Partial so that sets logged online,
-- which carry no client id, are never treated as duplicates of one another.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_sets_client_id
ON workout_sets(workout_id, client_set_id) WHERE client_set_id IS NOT NULL;
