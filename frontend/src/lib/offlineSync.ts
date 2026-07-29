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
  // replayed half an hour later would arrive with nobody reading it.
  /^\/workouts\/\d+\/chat(\/|$)/,
  /^\/onboarding\/objective\//,
  /^\/training-plans\/automatic/,
  /^\/training-plans\/\d+\/adjust/,
  // Never queue the user's own API key: the queue is persisted in localStorage
  // in clear text, so an offline save would leave a third-party credential
  // sitting on the device indefinitely. The server also validates the key
  // against the provider before storing it, which cannot happen offline.
  /^\/llm-settings/,
  /^\/subscription\//,
  // Starting a session must reach the server: it returns the workout id and the
  // day's exercises, and the optimistic 202 payload has neither — the guided
  // screen would open on a dead end.
  /^\/workouts\/start/,
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

export function normalizePath(url: string): string {
  const withoutBase = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '');
  return withoutBase.startsWith('/') ? withoutBase : `/${withoutBase}`;
}

export function isMutationMethod(method: string | undefined): method is MutationMethod {
  return MUTATION_METHODS.includes((method ?? '').toUpperCase() as MutationMethod);
}

export function isOnlineOnlyPath(url: string): boolean {
  const path = normalizePath(url);
  return ONLINE_ONLY_PATHS.some((pattern) => pattern.test(path));
}

/**
 * True when the URL points at an entity created offline (ids are negative while
 * they wait for the server). Replaying `PUT /workouts/-3` would 404 — see the
 * known limitation about server-generated ids.
 */
export function referencesLocalId(url: string): boolean {
  return /\/-\d+(\/|$|\?)/.test(normalizePath(url));
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
 */
export function isQueueableFailure(error: unknown): boolean {
  return isConnectivityError(error) && !isTimeoutError(error);
}

// --- mutation queue ---------------------------------------------------------

export type MutationExecutor = (mutation: PendingMutation) => Promise<void>;

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
        await executeMutation(mutation);
        removeFromQueue(mutation.localId);
        replayed += 1;
      } catch (error) {
        if (isConnectivityError(error)) {
          // A timeout is not proof the write failed — the server may well have
          // applied it. Retrying would duplicate the series; parking it lets the
          // person decide. Anything else is a real disconnection: keep the queue.
          if (isTimeoutError(error)) {
            moveToFailed(mutation, 'A resposta do servidor demorou demais. Não dá para saber se foi salvo, então não reenviamos automaticamente.');
            continue;
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
        // is parked as failed. A 5xx may be temporary and gets a few retries
        // before it is parked too — either way the queue never deadlocks.
        if ((status >= 400 && status < 500) || attempts >= MAX_MUTATION_ATTEMPTS) {
          moveToFailed(mutation, reason);
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
    invalidateCacheByPrefix('get:/workouts');
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
