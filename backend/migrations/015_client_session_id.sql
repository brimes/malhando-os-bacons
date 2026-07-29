-- Offline start: the client mints the session identity (a UUID) before it has
-- any connectivity, builds the session locally and queues the start request.
-- When the network returns the queue replays it, possibly more than once after
-- a timeout, so the server must be able to recognise a replay instead of
-- creating a second workout.
ALTER TABLE workouts
ADD COLUMN IF NOT EXISTS client_session_id TEXT;

-- Uniqueness is per user: two people may generate the same id (or replay the
-- same queued payload) without colliding with each other. Partial so that the
-- rows created online, which carry no client id, are not all treated as equal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_client_session
ON workouts(user_id, client_session_id) WHERE client_session_id IS NOT NULL;
