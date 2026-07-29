// Phase state of the guided workout session, kept in localStorage so closing
// the app mid-set does not throw the session away.
//
// Only the screen's own state lives here: which phase is running, when it
// started, which exercise is selected and the weights typed but not yet sent.
// The completed series are NOT duplicated locally — those come from
// `workoutsApi.active()`, and a second copy would only be a chance to disagree
// with the server.

export type WorkoutSessionPhase = 'countdown' | 'executing' | 'resting' | 'rest_done' | 'exercise_done' | 'done';

const STORAGE_KEY = 'mob_workout_session';

// A session left open overnight is not a session anyone is coming back to.
// Restoring "resting since 14 hours ago" would be noise, so it is dropped.
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const PHASES: WorkoutSessionPhase[] = ['countdown', 'executing', 'resting', 'rest_done', 'exercise_done', 'done'];

export interface PersistedWorkoutSession {
  workoutId: number;
  phase: WorkoutSessionPhase;
  /**
   * Epoch ms of when the phase started. Absolute on purpose: on restore the
   * elapsed time is recomputed from it, so a series carries on from where it
   * was instead of starting over.
   */
  phaseStart: number;
  currentExerciseId: number | null;
  finishedExerciseId: number | null;
  /** Weight fields as typed, keyed by exercise id — raw text so an empty field stays empty. */
  weights: Record<number, string>;
  savedAt: number;
}

function isPhase(value: unknown): value is WorkoutSessionPhase {
  return typeof value === 'string' && PHASES.includes(value as WorkoutSessionPhase);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

/** localStorage is user-writable and survives deploys, so the shape is checked field by field. */
function parseSession(raw: string): PersistedWorkoutSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.workoutId !== 'number') return null;
  if (!isPhase(candidate.phase)) return null;
  if (typeof candidate.phaseStart !== 'number' || !Number.isFinite(candidate.phaseStart)) return null;
  if (typeof candidate.savedAt !== 'number') return null;
  if (!isNullableNumber(candidate.currentExerciseId) || !isNullableNumber(candidate.finishedExerciseId)) return null;

  const weights: Record<number, string> = {};
  if (typeof candidate.weights === 'object' && candidate.weights !== null) {
    for (const [key, value] of Object.entries(candidate.weights as Record<string, unknown>)) {
      const exerciseId = Number(key);
      if (Number.isFinite(exerciseId) && typeof value === 'string') weights[exerciseId] = value;
    }
  }

  return {
    workoutId: candidate.workoutId,
    phase: candidate.phase,
    phaseStart: candidate.phaseStart,
    currentExerciseId: candidate.currentExerciseId,
    finishedExerciseId: candidate.finishedExerciseId,
    weights,
    savedAt: candidate.savedAt,
  };
}

/**
 * Returns the stored state when it belongs to `workoutId` and is still fresh.
 * Otherwise returns `null` without touching storage — a look-up is a read,
 * and only actual staleness (nobody is coming back to resume a session left
 * open for `MAX_AGE_MS`) is a reason to clear it. A mismatched id on its own
 * is not: the id in memory can briefly disagree with what is stored around a
 * remap or a fresh start, and a query landing in that window must not be
 * the thing that throws away a still-live session it merely was not asking
 * about. Whatever legitimately needs the slot cleared already does so
 * explicitly (finishing, cancelling, or `workoutsApi.active()` coming back
 * empty).
 */
export function loadWorkoutSessionState(workoutId: number): PersistedWorkoutSession | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  const stored = parseSession(raw);
  // Unreadable (corrupt JSON, a shape from an old app version): nothing to
  // return either way, and there is no "wrong id" risk in clearing something
  // that could not be attributed to any workout in the first place.
  if (!stored) {
    clearWorkoutSessionState();
    return null;
  }
  if (Date.now() - stored.savedAt > MAX_AGE_MS) {
    clearWorkoutSessionState();
    return null;
  }
  if (stored.workoutId !== workoutId) return null;
  return stored;
}

export function saveWorkoutSessionState(state: PersistedWorkoutSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full quota must never break the workout that is running.
  }
}

/**
 * Swaps the workout id the stored phase belongs to. Called when a session that
 * was started offline finally reaches the server and gets its real id: without
 * this the state would still be filed under the negative id, `loadWorkoutSessionState`
 * would reject it as belonging to another workout, and the timer — plus every
 * weight typed but not yet sent — would be thrown away on the next reload.
 */
export function remapWorkoutSessionState(localId: number, realId: number): void {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  const stored = parseSession(raw);
  if (!stored || stored.workoutId !== localId) return;
  saveWorkoutSessionState({ ...stored, workoutId: realId });
}

export function clearWorkoutSessionState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the entry is either gone or unreachable.
  }
}
