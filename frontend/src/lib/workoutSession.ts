// Everything the guided session needs to exist without a connection: minting the
// idempotency key, assembling an ActiveWorkout out of the plan this device has
// cached, and swapping the local id for the real one once the queued start
// finally reaches the server.
//
// It deliberately imports only `offlineStore` (state) and `requestPath` (parsing),
// never `offlineSync` — the queue replay imports *this* module to reconcile ids,
// so the dependency has to point one way.

import type { ActiveWorkout, CompleteWorkoutExercise, TrainingPlan, TrainingPlanDay, Workout, WorkoutSet } from '../types';
import type { PendingMutation } from '../types/offline';
import {
  dropQueuedMutations,
  getQueue,
  isLocalId,
  readLocalActiveSession,
  rewriteQueuedUrls,
  takeLocalId,
  useOfflineStore,
  writeLocalActiveSession,
} from './offlineStore';
import { normalizeRoute } from './requestPath';
import { remapWorkoutSessionState } from './workoutSessionState';

const START_ROUTE = '/workouts/start';
/** `/workouts/{id}/finish` and `/workouts/{id}/complete` both close a session. */
const CLOSE_ROUTE = /^\/workouts\/(-?\d+)\/(finish|complete)$/;
// Cancel ends the session too. It is kept apart from CLOSE_ROUTE because a
// cancelled workout is not history — it must not count towards the week.
const END_ROUTE = /^\/workouts\/(-?\d+)\/(finish|complete|cancel)$/;
/** Cached snapshots of a single plan — the only place the days and exercises live. */
const PLAN_DETAIL_KEY = /^get:\/training-plans\/\d+$/;

/** Raised when a session cannot be opened offline because the plan is not on the device. */
export class OfflineSessionUnavailableError extends Error {
  constructor(message = 'Este treino ainda não foi aberto neste aparelho. Conecte-se uma vez para poder iniciá-lo sem internet.') {
    super(message);
    this.name = 'OfflineSessionUnavailableError';
  }
}

/** Raised when another day's session is already open on this device. */
export class OfflineSessionConflictError extends Error {
  constructor(message = 'Já existe um treino em andamento. Finalize-o antes de começar outro.') {
    super(message);
    this.name = 'OfflineSessionConflictError';
  }
}

/**
 * Identity for one attempt at starting a session. The server dedupes on it, so
 * the same value may be sent as many times as the queue needs without ever
 * opening a second workout.
 */
export function newClientSessionId(): string {
  const webCrypto = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  // Android WebViews below Chrome 92 have no randomUUID, and neither does a
  // non-secure origin. Uniqueness only has to hold for one device, and the value
  // must match the server's `[A-Za-z0-9-]{1,64}` — base36 plus hyphens does.
  const chunk = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${chunk()}-${chunk()}`;
}

/** True for the request that opens a session. */
export function isWorkoutStartRequest(url: string): boolean {
  return normalizeRoute(url) === START_ROUTE;
}

function clientSessionIdOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as { client_session_id?: unknown }).client_session_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * True when the request may be replayed even though we cannot tell whether the
 * server saw it (a timeout). Only the start qualifies, and only when it carries
 * the key the server dedupes on — everything else keeps the safe default of not
 * resending a write that may already have been applied.
 */
export function isIdempotentRetryable(url: string, body: unknown): boolean {
  return isWorkoutStartRequest(url) && clientSessionIdOf(body) !== undefined;
}

// --- building a session from the cache --------------------------------------

/**
 * Looks for a plan day across every plan snapshot this device holds. The start
 * only knows the day id, and the day (with its exercises and `last_weight_kg`)
 * only exists inside `GET /training-plans/{id}` — the plan list does not carry it.
 */
export function findCachedPlanDay(dayId: number): { plan: TrainingPlan; day: TrainingPlanDay } | null {
  const { cache } = useOfflineStore.getState();
  for (const [key, entry] of Object.entries(cache)) {
    if (!PLAN_DETAIL_KEY.test(key)) continue;
    const plan = entry.data as TrainingPlan | null;
    const day = plan?.days?.find((candidate) => candidate.id === dayId);
    if (plan && day) return { plan, day };
  }
  return null;
}

export function readCachedActiveWorkout(): ActiveWorkout | null {
  return readLocalActiveSession<ActiveWorkout>();
}

/** Writes the session where `workoutsApi.active()` will find it while offline. */
export function storeLocalActiveWorkout(session: ActiveWorkout | null): void {
  writeLocalActiveSession(session);
}

/**
 * The training plan day a workout belongs to, read from the local session
 * slot — but only when it is still the one describing `workoutId`. Used to
 * label a `finish`/`complete` mutation with its day at the moment it is
 * queued (see `client.ts`), because by the time anything reads the queue
 * later the session that knew the answer may already have been cleared.
 */
export function dayIdForActiveWorkout(workoutId: number): number | undefined {
  const session = readCachedActiveWorkout();
  return session && session.workout.id === workoutId ? session.workout.training_plan_day_id : undefined;
}

function buildLocalActiveWorkout(input: {
  workoutId: number;
  clientSessionId: string;
  plan: TrainingPlan;
  day: TrainingPlanDay;
}): ActiveWorkout {
  const now = new Date().toISOString();
  const workout: Workout = {
    id: input.workoutId,
    // The account id is never read by the session screen and the server assigns
    // the real one from the token, so there is nothing meaningful to put here.
    user_id: 0,
    name: input.day.name,
    date: now,
    training_plan_day_id: input.day.id,
    status: 'in_progress',
    started_at: now,
    client_session_id: input.clientSessionId,
    sets: [],
    created_at: now,
  };
  return {
    workout,
    plan_id: input.plan.id,
    day_name: input.day.name,
    exercises: input.day.exercises ?? [],
  };
}

function dropQueuedStart(clientSessionId: string): void {
  dropQueuedMutations((mutation) => (
    mutation.method === 'POST'
    && isWorkoutStartRequest(mutation.url)
    && clientSessionIdOf(mutation.body) === clientSessionId
  ));
}

/**
 * Assembles the session the server could not hand us. Called right after the
 * queue accepted the start, so the POST is already pending — every path that
 * cannot produce a session drops it again, otherwise the replay would create a
 * workout on the server that nobody on this device is tracking.
 */
export function openOfflineSession(input: {
  trainingPlanDayId: number;
  clientSessionId: string;
  workoutId: number;
}): ActiveWorkout {
  const open = readCachedActiveWorkout();
  if (open && open.workout.status === 'in_progress') {
    // Same rule the server applies: one session at a time, and starting the day
    // that is already open just resumes it.
    dropQueuedStart(input.clientSessionId);
    if (open.workout.training_plan_day_id === input.trainingPlanDayId) return open;
    throw new OfflineSessionConflictError();
  }

  const found = findCachedPlanDay(input.trainingPlanDayId);
  if (!found) {
    dropQueuedStart(input.clientSessionId);
    throw new OfflineSessionUnavailableError();
  }

  const session = buildLocalActiveWorkout({
    workoutId: input.workoutId,
    clientSessionId: input.clientSessionId,
    plan: found.plan,
    day: found.day,
  });
  storeLocalActiveWorkout(session);
  return session;
}

/**
 * Mirrors a bulk checklist onto the cached session. `POST /workouts/{id}/progress`
 * normally answers with the updated session, but a queued call only echoes the
 * request back — without this the guided screen would reopen asking for the very
 * series the person just ticked.
 */
export function applyChecklistLocally(workoutId: number, entries: CompleteWorkoutExercise[]): ActiveWorkout | null {
  const cached = readCachedActiveWorkout();
  if (!cached || cached.workout.id !== workoutId) return null;

  const existing = cached.workout.sets ?? [];
  const sets = [...existing];
  const now = new Date().toISOString();
  for (const entry of entries) {
    const exercise = cached.exercises.find((item) => item.id === entry.training_plan_exercise_id);
    // Only the gap is filled: series already recorded by the guided flow keep the
    // reps and duration they were logged with.
    const already = existing.filter((set) => set.training_plan_exercise_id === entry.training_plan_exercise_id).length;
    for (let setNumber = already + 1; setNumber <= entry.sets_done; setNumber += 1) {
      const set: WorkoutSet = {
        id: takeLocalId(),
        workout_id: workoutId,
        exercise_name: exercise?.exercise_name ?? '',
        sets: exercise?.sets ?? entry.sets_done,
        reps: exercise?.reps ?? 0,
        tracking_type: exercise?.tracking_type ?? 'reps',
        weight_kg: entry.weight_kg,
        training_plan_exercise_id: entry.training_plan_exercise_id,
        set_number: setNumber,
        created_at: now,
      };
      sets.push(set);
    }
  }

  const updated: ActiveWorkout = { ...cached, workout: { ...cached.workout, sets } };
  storeLocalActiveWorkout(updated);
  return updated;
}

// --- id reconciliation ------------------------------------------------------

type WorkoutIdRemapListener = (localId: number, realId: number) => void;

const remapListeners = new Set<WorkoutIdRemapListener>();

/**
 * Notifies an open session screen that its workout just got its real id. Without
 * it the component would keep the negative id in memory and write it straight
 * back over the persisted phase state on the next render.
 */
export function onWorkoutIdRemap(listener: WorkoutIdRemapListener): () => void {
  remapListeners.add(listener);
  return () => {
    remapListeners.delete(listener);
  };
}

/** Matches `/workouts/{id}` as a whole path segment — not a prefix of a longer id. */
function workoutRoutePattern(workoutId: number): RegExp {
  return new RegExp(`(^|/)workouts/${workoutId}(?=/|$)`);
}

function rewriteQueuedWorkoutId(localId: number, realId: number): void {
  // Only the segment right after `/workouts/` is replaced: an id further down the
  // path (`/sets/-3`) belongs to a different entity and is not this one's to fix.
  const pattern = workoutRoutePattern(localId);
  rewriteQueuedUrls((url) => url.replace(pattern, `$1workouts/${realId}`));
}

/**
 * True when something is still queued for `workoutId` — the start itself, a
 * series, a finish, anything. Tells a genuine "no active workout" apart from
 * a `GET /workouts/active` that simply raced ahead of `flushQueue`: the
 * session the queue is about to create (or has not fully synced) does not
 * exist on the server yet, so the server's own answer about it cannot be
 * trusted over what is still waiting to go out.
 */
function hasQueuedWorkFor(workoutId: number): boolean {
  const pattern = workoutRoutePattern(workoutId);
  return getQueue().some((mutation) => pattern.test(normalizeRoute(mutation.url)));
}

/**
 * Swaps a workout's local id for the one the server assigned, everywhere it was
 * written: the mutations still queued behind the start, the cached session the
 * screen re-reads, and the persisted phase state.
 */
export function remapLocalWorkoutId(localId: number, realId: number): void {
  if (localId >= 0 || realId <= 0 || localId === realId) return;

  rewriteQueuedWorkoutId(localId, realId);

  const cached = readCachedActiveWorkout();
  if (cached && cached.workout.id === localId) {
    // The series recorded offline are kept as they are: they are still queued, so
    // the server's copy of this workout has none of them yet and overwriting the
    // snapshot with it would empty the screen mid-session.
    storeLocalActiveWorkout({ ...cached, workout: { ...cached.workout, id: realId } });
  }

  remapWorkoutSessionState(localId, realId);
  remapListeners.forEach((listener) => listener(localId, realId));
}

/**
 * Raised when a replayed start's response cannot be trusted. The HTTP request
 * itself succeeded — it is already off the queue by the time this is thrown —
 * but the `client_session_id` it deduped on had already produced a workout,
 * and that workout is not the one still running here (most often it is
 * `completed`: this exact start was replayed after the session it opened was
 * already finished, which happens when a slow first attempt is retried after
 * a timeout). Caught only by the queue in `offlineSync.ts` — a screen never
 * sees this, since nothing it did is what failed.
 */
export class WorkoutStartConflictError extends Error {
  constructor(public readonly localId: number, public readonly workout: Workout) {
    super(`O treino já foi encerrado no servidor (status: ${workout.status}) antes que este aparelho pudesse sincronizar. O progresso feito aqui não foi enviado.`);
    this.name = 'WorkoutStartConflictError';
  }
}

/**
 * Called by the queue after a mutation replays. When it was the start of a
 * session opened offline, the response carries the real workout id and everything
 * pointing at the local one is rewritten — unless the workout the server handed
 * back is not actually the one still in progress here, in which case remapping
 * would only point every queued set and finish at a closed workout.
 */
export function reconcileWorkoutStart(mutation: PendingMutation, response: unknown): void {
  if (mutation.method !== 'POST' || !isWorkoutStartRequest(mutation.url)) return;
  const localId = mutation.localEntityId;
  if (typeof localId !== 'number' || localId >= 0) return;
  const workout = (response as ActiveWorkout | undefined)?.workout;
  const realId = workout?.id;
  if (typeof realId !== 'number' || realId <= 0) return;
  if (workout && workout.status !== 'in_progress') {
    throw new WorkoutStartConflictError(localId, workout);
  }
  remapLocalWorkoutId(localId, realId);
}

/**
 * Every other queued mutation that only makes sense once `mutation` (a start)
 * succeeds: the series, the finish, anything else still addressed at the
 * local id it was going to become real. Used when a start fails for good —
 * without this, each one would be replayed in turn against a workout that
 * was never created (or that the queue has just given up on reconciling) and
 * fail as its own avoidable 404, one at a time.
 */
export function dependentMutationsOf(mutation: PendingMutation, queue: PendingMutation[] = getQueue()): PendingMutation[] {
  if (mutation.method !== 'POST' || !isWorkoutStartRequest(mutation.url)) return [];
  const localId = mutation.localEntityId;
  if (typeof localId !== 'number' || localId >= 0) return [];
  const pattern = workoutRoutePattern(localId);
  return queue.filter((queued) => queued.localId !== mutation.localId && pattern.test(normalizeRoute(queued.url)));
}

/**
 * Decides what `GET /workouts/active` should hand back once the network
 * answer (real or the interceptor's own generic-cache fallback) is known. The
 * dedicated session slot stays authoritative — never overwritten and used
 * instead of the answer — whenever this device still has unsynced work for
 * the session it remembers: a start not yet reconciled, or a series/finish
 * still queued behind an id that has already synced. Without this, a GET that
 * lands slightly before `flushQueue` finishes (very much possible right after
 * reconnecting) would read as "nothing running" or "fewer sets than this
 * screen already shows", and either one throws away what has not synced yet.
 */
export function reconcileActiveSessionRead(server: ActiveWorkout | null): ActiveWorkout | null {
  const local = readCachedActiveWorkout();
  if (server) {
    if (local && local.workout.id === server.workout.id && (isLocalId(local.workout.id) || hasQueuedWorkFor(server.workout.id))) {
      return local;
    }
    writeLocalActiveSession(server);
    return server;
  }
  if (local && (isLocalId(local.workout.id) || hasQueuedWorkFor(local.workout.id))) {
    return local;
  }
  writeLocalActiveSession(null);
  return null;
}

// --- what the queue says about the week -------------------------------------

/** A session completed on this device that the server has not been told about yet. */
export interface LocalCompletedWorkout {
  trainingPlanDayId: number;
  /** Epoch ms of when it was closed. */
  completedAt: number;
}

/**
 * True for `POST /workouts/{id}/finish` and `POST /workouts/{id}/complete` —
 * the two requests that close a session. Exported so `client.ts` can tag a
 * queued one with its training plan day the moment it is enqueued (see
 * `dayIdForActiveWorkout`), while the local session that still knows the
 * answer is guaranteed to exist.
 */
export function parseCloseRoute(url: string): { workoutId: number } | null {
  const match = normalizeRoute(url).match(CLOSE_ROUTE);
  return match ? { workoutId: Number(match[1]) } : null;
}

/**
 * Reads the pending queue as workout history. A session closed with no signal
 * exists nowhere else: the cached `/workouts` list predates it and the plan's
 * `last_done_at` still points at the previous time. Without this the week
 * would keep showing a workout the person already did as missing, and "o
 * treino da vez" would send them back to the one they just finished.
 *
 * Two sources are combined for the day a closing mutation belongs to, because
 * either one alone misses a real case:
 *  - `startedOffline`, built from the queue itself, covers a session that
 *    both started and finished with no signal — its start is still sitting
 *    right there, ahead of the finish, with the day id in its own body.
 *  - `mutation.trainingPlanDayId`, stamped onto the mutation when it was
 *    enqueued (see `client.ts`), covers everything `startedOffline` cannot:
 *    the start already synced and dropped out of the queue by the time the
 *    finish did not, or the session was started online in the first place and
 *    never had a queued start to look the day id up from at all.
 */
export function pendingCompletedWorkouts(queue: PendingMutation[] = getQueue()): LocalCompletedWorkout[] {
  const startedOffline = new Map<number, number>();
  for (const mutation of queue) {
    if (mutation.method !== 'POST' || !isWorkoutStartRequest(mutation.url)) continue;
    const dayId = (mutation.body as { training_plan_day_id?: unknown } | undefined)?.training_plan_day_id;
    if (typeof mutation.localEntityId !== 'number' || typeof dayId !== 'number') continue;
    startedOffline.set(mutation.localEntityId, dayId);
  }

  const completed: LocalCompletedWorkout[] = [];
  for (const mutation of queue) {
    if (mutation.method !== 'POST') continue;
    const match = normalizeRoute(mutation.url).match(CLOSE_ROUTE);
    if (!match) continue;
    const dayId = startedOffline.get(Number(match[1])) ?? mutation.trainingPlanDayId;
    if (dayId !== undefined) completed.push({ trainingPlanDayId: dayId, completedAt: mutation.createdAt });
  }
  return completed;
}

/**
 * True for any request whose whole purpose is to leave no open session behind:
 * finish, complete or cancel.
 */
export function parseSessionEndRoute(url: string): { workoutId: number } | null {
  const match = normalizeRoute(url).match(END_ROUTE);
  return match ? { workoutId: Number(match[1]) } : null;
}

/**
 * Forgets the local session when it is the one being referred to. Used when the
 * server reports it has no such open workout: the end state the request was
 * asking for is already true, so keeping the session on the device would leave
 * a workout on screen that cannot be closed — cancelling again only queues
 * another doomed request.
 */
export function forgetLocalSessionIfMatches(workoutId: number): boolean {
  const current = readCachedActiveWorkout();
  if (!current || current.workout.id !== workoutId) return false;
  storeLocalActiveWorkout(null);
  return true;
}
