import axios from 'axios';
import type { MutationMethod, PendingMutation, ResourceKey } from '../types/offline';
import {
  isNetworkOnline,
  onNetworkStatusChange,
  reportNetworkFailure,
} from './network';
import {
  getQueue,
  invalidateCacheByPrefix,
  markSynced,
  moveToFailed,
  patchQueuedMutation,
  pushToQueue,
  readCache,
  removeFromQueue,
  setOnline,
  setSyncing,
  writeCache,
} from './offlineStore';
import { normalizePath, normalizeRoute } from './requestPath';
import { dependentMutationsOf, isIdempotentRetryable, reconcileWorkoutStart, WorkoutStartConflictError } from './workoutSession';

/** A mutation that keeps failing on the server is dropped instead of blocking the queue forever. */
const MAX_MUTATION_ATTEMPTS = 5;
/** Cap on how many resources `syncNow()` refreshes, newest first. */
const MAX_TRACKED_RESOURCES = 24;
/** Key used only to timestamp a successful queue flush. */
export const QUEUE_SYNC_KEY = 'sync:queue';

/**
 * Endpoints that must never be queued: their whole point is the server's answer
 * (an assistant reply, a token, a job id to poll). Replaying them minutes later
 * would either be useless or produce a response nobody is waiting for anymore.
 */
const ONLINE_ONLY_PATHS: RegExp[] = [
  /^\/auth\//,
  /^\/chat(\/|$)/,
  // Dúvidas durante o treino: the answer is generated live, so a question
  // replayed half an hour later would arrive with nobody reading it. `-?`
  // covers a session still running on its offline-assigned id — otherwise a
  // question asked before the start syncs falls through to the generic
  // "não sincronizado" queueing path instead of the clear "precisa de
  // internet" message this path exists to give it.
  /^\/workouts\/-?\d+\/chat(\/|$)/,
  /^\/onboarding\/objective\//,
  /^\/training-plans\/automatic/,
  /^\/training-plans\/\d+\/adjust/,
  // Never queue the user's own API key: the queue is persisted in localStorage
  // in clear text, so an offline save would leave a third-party credential
  // sitting on the device indefinitely. The server also validates the key
  // against the provider before storing it, which cannot happen offline.
  /^\/llm-settings/,
  /^\/subscription\//,
];

/**
 * Paths allowed to carry an id that only exists on this device. The rule below
 * exists because replaying `PUT /workouts/-3` would 404, but the guided session
 * is the one case where the whole chain is queued together: the start is
 * replayed first and rewrites these URLs with the real id before they go out
 * (see `reconcileWorkoutStart`). Without the exception a workout started in the
 * gym with no signal could not record a single series.
 */
const LOCAL_ID_ALLOWED_PATHS: RegExp[] = [
  /^\/workouts\/-\d+\/(sets|finish|complete|progress|cancel)$/,
];

const MUTATION_METHODS: MutationMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Raised by reads that have no cached copy to fall back on. */
export class OfflineUnavailableError extends Error {
  constructor(message = 'Sem conexão e sem dados salvos neste dispositivo.') {
    super(message);
    this.name = 'OfflineUnavailableError';
  }
}

/** Raised when a write touches something that only exists locally. */
export class UnsyncedDependencyError extends Error {
  constructor(message = 'Este item ainda não foi sincronizado. Conecte-se à internet para alterá-lo.') {
    super(message);
    this.name = 'UnsyncedDependencyError';
  }
}

// --- request classification -------------------------------------------------

export { normalizePath } from './requestPath';

export function isMutationMethod(method: string | undefined): method is MutationMethod {
  return MUTATION_METHODS.includes((method ?? '').toUpperCase() as MutationMethod);
}

export function isOnlineOnlyPath(url: string): boolean {
  const path = normalizePath(url);
  return ONLINE_ONLY_PATHS.some((pattern) => pattern.test(path));
}

/**
 * True when the URL points at an entity created offline (ids are negative while
 * they wait for the server) and there is no way to fix it up later. Replaying
 * `PUT /workouts/-3` would 404 — see the known limitation about server-generated
 * ids. The guided-session paths are exempt: their local id is rewritten by the
 * replay of the start that created it.
 */
export function referencesLocalId(url: string): boolean {
  const route = normalizeRoute(url);
  if (!/\/-\d+(\/|$)/.test(route)) return false;
  return !LOCAL_ID_ALLOWED_PATHS.some((pattern) => pattern.test(route));
}

/**
 * A request that came back without any response never reached the server:
 * offline, DNS failure, refused connection or timeout.
 */
export function isConnectivityError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

function isTimeoutError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
}

/**
 * Only failures we are sure the server never saw get queued. A timeout is
 * excluded on purpose: the request may well have been processed, and replaying
 * it would duplicate the write — the user retrying by hand is the safer path.
 *
 * The one exception is a request the server itself dedupes (the session start,
 * keyed by `client_session_id`): resending it either creates the workout or
 * returns the one it already created, so a timeout is safe to queue.
 */
export function isQueueableFailure(error: unknown, request?: { url?: string; body?: unknown }): boolean {
  if (!isConnectivityError(error)) return false;
  if (!isTimeoutError(error)) return true;
  return request !== undefined && isIdempotentRetryable(request.url ?? '', request.body);
}

// --- mutation queue ---------------------------------------------------------

/** Resolves with the server's response body, which the replay needs to reconcile ids. */
export type MutationExecutor = (mutation: PendingMutation) => Promise<unknown>;

// The executor is injected by src/api/client.ts instead of imported here, so the
// queue does not depend on the axios instance that depends on the queue.
let executeMutation: MutationExecutor | null = null;

export function registerMutationExecutor(executor: MutationExecutor): void {
  executeMutation = executor;
  if (isNetworkOnline() && getQueue().length > 0) void flushQueue();
}

let localIdCounter = 0;

export function enqueueMutation(input: {
  method: MutationMethod;
  url: string;
  body?: unknown;
  params?: Record<string, unknown>;
  localEntityId?: number;
  trainingPlanDayId?: number;
}): PendingMutation {
  localIdCounter += 1;
  const mutation: PendingMutation = {
    localId: `${Date.now().toString(36)}-${localIdCounter}`,
    method: input.method,
    url: input.url,
    body: input.body,
    params: input.params,
    createdAt: Date.now(),
    attempts: 0,
    localEntityId: input.localEntityId,
    trainingPlanDayId: input.trainingPlanDayId,
  };
  pushToQueue(mutation);
  return mutation;
}

let runningFlush: Promise<void> | null = null;

/**
 * Replays the queue in FIFO order, one at a time. Order matters: a later
 * mutation may depend on an earlier one (finishing a workout after its sets),
 * so the first failure stops the run and leaves the rest for the next attempt.
 */
export function flushQueue(): Promise<void> {
  if (runningFlush) return runningFlush;
  runningFlush = runFlush().finally(() => {
    runningFlush = null;
  });
  return runningFlush;
}

/**
 * Fails a mutation and, when it was a workout start, everything still queued
 * behind it that only makes sense once the start succeeds (its series, its
 * finish). A start that is refused for good — a 409 "another workout is
 * already in progress" from a session forgotten open on another device is the
 * one seen in practice — would otherwise leave those pointing at a workout
 * that was never created: each one replayed in turn, each one its own 404,
 * until the queue burns through every attempt on its own. Parking them
 * together, with a reason that says why, turns that into one legible entry
 * instead of a trickle of "not found" nobody asked for.
 */
function failMutationAndDependents(mutation: PendingMutation, reason: string): void {
  const dependents = dependentMutationsOf(mutation);
  moveToFailed(mutation, reason);
  if (dependents.length === 0) return;
  const explanation = `Não foi possível enviar: o início deste treino falhou (${reason}).`;
  for (const dependent of dependents) moveToFailed(dependent, explanation);
}

async function runFlush(): Promise<void> {
  if (!executeMutation || !isNetworkOnline()) return;
  if (getQueue().length === 0) return;

  setSyncing(true);
  let replayed = 0;
  try {
    // Re-read the queue on every step: a screen may have appended to it while
    // the previous replay was in flight.
    for (let mutation = getQueue()[0]; mutation !== undefined; mutation = getQueue()[0]) {
      try {
        const result = await executeMutation(mutation);
        removeFromQueue(mutation.localId);
        replayed += 1;
        try {
          // Must happen before the next iteration: everything queued behind a
          // session start still addresses `/workouts/-1/...` and would 404
          // unless the real id the server just returned is swapped in first.
          reconcileWorkoutStart(mutation, result);
        } catch (conflict) {
          if (!(conflict instanceof WorkoutStartConflictError)) throw conflict;
          // The start itself reached the server fine — it is already off the
          // queue — but the workout it deduped onto is not the one still open
          // here. Remapping would point every queued set and finish at a
          // closed workout, so instead the whole chain is parked as failed,
          // explained, with the local session and its recorded series left
          // untouched rather than silently discarded.
          failMutationAndDependents(mutation, conflict.message);
        }
      } catch (error) {
        if (isConnectivityError(error)) {
          // A timeout is not proof the write failed — the server may well have
          // applied it. Retrying would duplicate the series; parking it lets the
          // person decide. Anything else is a real disconnection: keep the queue.
          if (isTimeoutError(error)) {
            if (!isIdempotentRetryable(mutation.url, mutation.body)) {
              failMutationAndDependents(mutation, 'A resposta do servidor demorou demais. Não dá para saber se foi salvo, então não reenviamos automaticamente.');
              continue;
            }
            // The server dedupes this one, so a resend is safe. Attempts are still
            // counted so a server that always times out cannot wedge the queue —
            // and stopping here keeps the session's own writes behind it in order.
            const timedOutAttempts = mutation.attempts + 1;
            if (timedOutAttempts >= MAX_MUTATION_ATTEMPTS) {
              failMutationAndDependents(mutation, 'O servidor não respondeu depois de várias tentativas.');
              continue;
            }
            patchQueuedMutation(mutation.localId, {
              attempts: timedOutAttempts,
              lastError: 'O servidor demorou a responder. Vamos tentar de novo.',
            });
            break;
          }
          reportNetworkFailure();
          break;
        }
        const attempts = mutation.attempts + 1;
        const status = axios.isAxiosError(error) ? error.response?.status ?? 0 : 0;
        const reason = describeError(error);
        // An expired session rejects every pending write the same way. Parking
        // them one by one would burn the whole queue (and the failed list only
        // keeps the last few), so stop and keep everything for after re-login.
        if (status === 401 || status === 403) {
          patchQueuedMutation(mutation.localId, { lastError: 'Sessão expirada. Entre de novo para enviar o que ficou pendente.' });
          break;
        }
        // A 4xx will never succeed on replay (duplicate, stale, refused), so it
        // is parked as failed — along with anything that only made sense once
        // this one went through. A 5xx may be temporary and gets a few retries
        // before it is parked too — either way the queue never deadlocks.
        if ((status >= 400 && status < 500) || attempts >= MAX_MUTATION_ATTEMPTS) {
          failMutationAndDependents(mutation, reason);
          continue;
        }
        patchQueuedMutation(mutation.localId, { attempts, lastError: reason });
        break;
      }
    }
  } finally {
    setSyncing(false);
  }

  if (replayed > 0) {
    markSynced(QUEUE_SYNC_KEY);
    // Snapshots read outside `readThrough` (the guided session calls the API
    // directly) are not tracked and would keep serving pre-sync data — with
    // local negative ids that no longer match the server. Dropping them forces
    // the next read to go out, which now succeeds since the queue just drained.
    //
    // Only once it really drained, though: with writes still queued the server's
    // copy is behind the device's, and re-reading it would wipe series that are
    // waiting to be sent off a session that is still running.
    if (getQueue().length === 0) invalidateCacheByPrefix('get:/workouts');
    // The local snapshots predate everything that was just replayed.
    await revalidateTrackedResources();
  }
}

function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    return data?.error ?? error.message;
  }
  return error instanceof Error ? error.message : 'Erro desconhecido';
}

// --- read-through cache -----------------------------------------------------

interface TrackedResource {
  run: () => Promise<void>;
}

// Kept so `syncNow()` can refresh exactly what the app has already displayed.
const trackedResources = new Map<ResourceKey, TrackedResource>();

export interface ReadThroughOptions<T> {
  resourceKey: ResourceKey;
  fetcher: () => Promise<T>;
  /** Called with the cached copy first (when there is one), then with the fresh one. */
  apply: (data: T, origin: 'cache' | 'network') => void;
  /** Called when the network read fails; `hadCache` tells whether the screen has something to show. */
  onError?: (error: unknown, hadCache: boolean) => void;
  /** Skip storing the payload — for volatile or oversized responses. */
  cacheable?: boolean;
}

/**
 * Offline-first read: hands over the local copy immediately, then revalidates
 * in the background whenever there is a connection. The screen never waits for
 * the network to show something it already has.
 */
export async function readThrough<T>(options: ReadThroughOptions<T>): Promise<void> {
  const { resourceKey, fetcher, apply, onError, cacheable = true } = options;

  if (trackedResources.size >= MAX_TRACKED_RESOURCES && !trackedResources.has(resourceKey)) {
    const oldest = trackedResources.keys().next().value;
    if (oldest !== undefined) trackedResources.delete(oldest);
  }
  trackedResources.delete(resourceKey);
  trackedResources.set(resourceKey, { run: () => revalidate(options) });

  const cached = readCache<T>(resourceKey);
  const hadCache = cached !== undefined;
  if (hadCache) apply(cached as T, 'cache');

  if (!isNetworkOnline()) {
    if (!hadCache) onError?.(new OfflineUnavailableError(), false);
    return;
  }

  try {
    const fresh = await fetcher();
    if (cacheable) writeCache(resourceKey, fresh);
    else markSynced(resourceKey);
    apply(fresh, 'network');
  } catch (error) {
    if (isConnectivityError(error)) reportNetworkFailure();
    onError?.(error, hadCache);
  }
}

/** Same as `readThrough` minus the cache-first hand-over: used by `syncNow()`. */
async function revalidate<T>(options: ReadThroughOptions<T>): Promise<void> {
  const { resourceKey, fetcher, apply, onError, cacheable = true } = options;
  if (!isNetworkOnline()) return;
  try {
    const fresh = await fetcher();
    if (cacheable) writeCache(resourceKey, fresh);
    else markSynced(resourceKey);
    apply(fresh, 'network');
  } catch (error) {
    if (isConnectivityError(error)) reportNetworkFailure();
    onError?.(error, true);
  }
}

async function revalidateTrackedResources(): Promise<void> {
  const runs = [...trackedResources.values()].map((resource) => resource.run());
  await Promise.allSettled(runs);
}

/** Flushes pending writes and refreshes every resource the app has read so far. */
export async function syncNow(): Promise<void> {
  await flushQueue();
  await revalidateTrackedResources();
}

// --- wiring -----------------------------------------------------------------

setOnline(isNetworkOnline());
onNetworkStatusChange((online) => {
  setOnline(online);
  // Connection is back: drain whatever piled up, then refresh the screens.
  if (online) void flushQueue();
});
