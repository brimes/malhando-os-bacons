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
 * State from another workout is discarded: the session it described is over or
 * was replaced, and reusing it would drop the person into the wrong exercise.
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
  if (!stored || stored.workoutId !== workoutId || Date.now() - stored.savedAt > MAX_AGE_MS) {
    clearWorkoutSessionState();
    return null;
  }
  return stored;
}

export function saveWorkoutSessionState(state: PersistedWorkoutSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full quota must never break the workout that is running.
  }
}

export function clearWorkoutSessionState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the entry is either gone or unreachable.
  }
}
