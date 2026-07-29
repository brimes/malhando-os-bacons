import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CacheEntry, FailedMutation, PendingMutation, ResourceKey } from '../types/offline';
import { isNetworkOnline } from './network';

const STORAGE_KEY = 'mob-offline';

// localStorage tops out around 5MB for the whole origin. A single resource that
// big is never worth keeping, and skipping it leaves room for the mutation
// queue — the only data here that exists nowhere else.
const MAX_CACHE_ENTRY_CHARS = 192 * 1024;
const MAX_FAILED_MUTATIONS = 20;
// Every GET is cached, and each month of the calendar or day of history becomes
// a permanent entry. Without a ceiling the cache grows until localStorage throws
// — and the recovery path can take the mutation queue down with it. Oldest
// entries are dropped first; they are re-fetched from the server on demand.
//
// The workout session in progress does NOT live in here — see `activeSession`
// below. It used to, and that was the bug: a session assembled offline has
// nowhere else to be re-fetched from, so it cannot share a bounded, prunable
// cache with things that do.
const MAX_CACHE_ENTRIES = 60;

interface OfflineStoreState {
  /** Resource snapshots keyed by `resourceKeyForRequest`. */
  cache: Record<ResourceKey, CacheEntry>;
  /** Epoch ms of the last successful read, per resource. */
  lastSyncAt: Record<ResourceKey, number>;
  queue: PendingMutation[];
  failed: FailedMutation[];
  /** Ids handed to entities created offline. Negative so they never hit a server id. */
  nextLocalId: number;
  /**
   * The one workout session currently running on this device (an `ActiveWorkout`
   * from `../types`, kept as `unknown` here so this module never has to import
   * the API types). It is a sibling of `queue`, not an entry of `cache`: a
   * session opened with no connection exists nowhere but here, so it must
   * survive `pruneCache`'s eviction and the quota-recovery path's `cache: {}`
   * exactly like the mutation queue does. See `lib/workoutSession.ts`, the
   * only module that reads and writes it.
   */
  activeSession: unknown;
  isOnline: boolean;
  isSyncing: boolean;
}

/** Everything that is worth writing to localStorage; the rest is per-session. */
type PersistedOfflineState = Pick<
  OfflineStoreState,
  'cache' | 'lastSyncAt' | 'queue' | 'failed' | 'nextLocalId' | 'activeSession'
>;

const initialState: OfflineStoreState = {
  cache: {},
  lastSyncAt: {},
  queue: [],
  failed: [],
  nextLocalId: -1,
  activeSession: null,
  isOnline: isNetworkOnline(),
  isSyncing: false,
};

// Guards the eviction path below against the write it triggers itself.
let isEvicting = false;

const quotaAwareStorage = createJSONStorage<PersistedOfflineState>(() => ({
  getItem: (name) => window.localStorage.getItem(name),
  setItem: (name, value) => {
    if (isEvicting) return;
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Quota blown. Cached reads can be fetched again from the server, pending
      // mutations cannot — so the caches go and the queue stays. `activeSession`
      // goes with the queue: a session opened offline is exactly the kind of
      // unrecoverable state this recovery path must not touch, the same way it
      // does not touch `queue` or `failed`.
      isEvicting = true;
      try {
        const { queue, failed, nextLocalId, activeSession } = useOfflineStore.getState();
        window.localStorage.setItem(
          name,
          JSON.stringify({ state: { cache: {}, lastSyncAt: {}, queue, failed, nextLocalId, activeSession }, version: 0 }),
        );
      } catch {
        window.localStorage.removeItem(name);
      }
      useOfflineStore.setState({ cache: {}, lastSyncAt: {} });
      isEvicting = false;
    }
  },
  removeItem: (name) => window.localStorage.removeItem(name),
}));

export const useOfflineStore = create<OfflineStoreState>()(
  persist(() => initialState, {
    name: STORAGE_KEY,
    storage: quotaAwareStorage,
    // isOnline/isSyncing describe this instant, never the last run.
    partialize: (state) => ({
      cache: state.cache,
      lastSyncAt: state.lastSyncAt,
      queue: state.queue,
      failed: state.failed,
      nextLocalId: state.nextLocalId,
      activeSession: state.activeSession,
    }),
  }),
);

/** Serializes query params into a stable key, so `{a,b}` and `{b,a}` match. */
function serializeParams(params: unknown): string {
  if (!params || typeof params !== 'object') return '';
  const entries = Object.entries(params as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, value]) => `${key}=${value}`).join('&');
}

/**
 * Cache key for a GET. The axios interceptor and the stores both call this, so
 * one URL means one entry in localStorage instead of two copies of the payload.
 */
export function resourceKeyForRequest(url: string, params?: unknown): ResourceKey {
  const path = url.startsWith('/') ? url : `/${url}`;
  const query = serializeParams(params);
  return `get:${path}${query ? `?${query}` : ''}`;
}

/** Returns the cached snapshot, or `undefined` when the resource was never read. */
export function readCache<T>(resourceKey: ResourceKey): T | undefined {
  const entry = useOfflineStore.getState().cache[resourceKey];
  return entry === undefined ? undefined : (entry.data as T);
}

export function readCacheEntry<T>(resourceKey: ResourceKey): CacheEntry<T> | undefined {
  return useOfflineStore.getState().cache[resourceKey] as CacheEntry<T> | undefined;
}

export function hasCache(resourceKey: ResourceKey): boolean {
  return useOfflineStore.getState().cache[resourceKey] !== undefined;
}

/** Oversized or unserializable payloads are skipped: an older, smaller snapshot beats none. */
function isStorable(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  try {
    return JSON.stringify(data).length <= MAX_CACHE_ENTRY_CHARS;
  } catch {
    return false;
  }
}

/** Stores a snapshot that came from the server and stamps `last_sync` for it. */
export function writeCache(resourceKey: ResourceKey, data: unknown): void {
  if (!isStorable(data)) return;
  const updatedAt = Date.now();
  useOfflineStore.setState((state) => ({
    cache: pruneCache({ ...state.cache, [resourceKey]: { data, updatedAt } }, resourceKey),
    lastSyncAt: { ...state.lastSyncAt, [resourceKey]: updatedAt },
  }));
}

/**
 * Keeps the cache bounded by dropping the least recently written entries. The
 * entry just written is always kept, no matter how full the cache was.
 */
function pruneCache(cache: Record<ResourceKey, CacheEntry>, keep: ResourceKey): Record<ResourceKey, CacheEntry> {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_CACHE_ENTRIES) return cache;
  const ordered = keys
    .filter((key) => key !== keep)
    .sort((a, b) => (cache[a]?.updatedAt ?? 0) - (cache[b]?.updatedAt ?? 0));
  const pruned = { ...cache };
  for (const key of ordered.slice(0, keys.length - MAX_CACHE_ENTRIES)) {
    delete pruned[key];
  }
  return pruned;
}

/**
 * Stores a snapshot changed locally (an optimistic write made offline). It
 * deliberately leaves `last_sync` alone — nothing was synchronised, and the
 * label on screen must keep showing the last time the server was actually read.
 */
export function patchCacheLocally(resourceKey: ResourceKey, data: unknown): void {
  if (!isStorable(data)) return;
  useOfflineStore.setState((state) => ({
    cache: {
      ...state.cache,
      [resourceKey]: { data, updatedAt: state.cache[resourceKey]?.updatedAt ?? 0 },
    },
  }));
}

/**
 * The workout session running on this device, or `null` when there is none.
 * Lives outside `cache` — see the field comment on `OfflineStoreState` — so it
 * is never pruned and never wiped by the quota-recovery path.
 */
export function readLocalActiveSession<T = unknown>(): T | null {
  return (useOfflineStore.getState().activeSession as T | null) ?? null;
}

/** Overwrites the session slot. `null` means "no session running right now". */
export function writeLocalActiveSession(session: unknown): void {
  useOfflineStore.setState({ activeSession: session ?? null });
}

export function invalidateCache(resourceKey: ResourceKey): void {
  useOfflineStore.setState((state) => {
    if (state.cache[resourceKey] === undefined) return state;
    const cache = { ...state.cache };
    delete cache[resourceKey];
    return { cache };
  });
}

/** Drops every cached snapshot whose key starts with the given prefix. */
export function invalidateCacheByPrefix(prefix: string): void {
  useOfflineStore.setState((state) => {
    const cache = Object.fromEntries(
      Object.entries(state.cache).filter(([key]) => !key.startsWith(prefix)),
    );
    return { cache };
  });
}

export function markSynced(resourceKey: ResourceKey, at = Date.now()): void {
  useOfflineStore.setState((state) => ({
    lastSyncAt: { ...state.lastSyncAt, [resourceKey]: at },
  }));
}

export function getLastSyncAt(resourceKey: ResourceKey): number | null {
  return useOfflineStore.getState().lastSyncAt[resourceKey] ?? null;
}

/** Most recent sync across every resource — what a "última sincronização" label shows. */
export function getLatestSyncAt(lastSyncAt = useOfflineStore.getState().lastSyncAt): number | null {
  const timestamps = Object.values(lastSyncAt);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

/**
 * Ids for entities created while offline. Negative and decreasing, so they are
 * unmistakable next to server ids and unique across app restarts.
 */
export function takeLocalId(): number {
  const id = useOfflineStore.getState().nextLocalId;
  useOfflineStore.setState({ nextLocalId: id - 1 });
  return id;
}

export function isLocalId(id: unknown): boolean {
  return typeof id === 'number' && id < 0;
}

export function getQueue(): PendingMutation[] {
  return useOfflineStore.getState().queue;
}

export function pushToQueue(mutation: PendingMutation): void {
  useOfflineStore.setState((state) => ({ queue: [...state.queue, mutation] }));
}

export function removeFromQueue(localId: string): void {
  useOfflineStore.setState((state) => ({
    queue: state.queue.filter((mutation) => mutation.localId !== localId),
  }));
}

/**
 * Removes queued mutations that match. Used to undo an action that never left
 * the device — cancelling the queued POST is the only correct "delete" for
 * something the server has never heard of.
 */
export function dropQueuedMutations(predicate: (mutation: PendingMutation) => boolean): number {
  const before = useOfflineStore.getState().queue;
  const queue = before.filter((mutation) => !predicate(mutation));
  if (queue.length === before.length) return 0;
  useOfflineStore.setState({ queue });
  return before.length - queue.length;
}

/**
 * Rewrites the URL of every queued mutation through `mapper`. Used when a POST
 * finally reaches the server and hands back the real id for something that was
 * created offline: everything queued behind it still points at the negative id
 * and would 404 on replay.
 */
export function rewriteQueuedUrls(mapper: (url: string) => string): void {
  useOfflineStore.setState((state) => ({
    queue: state.queue.map((mutation) => {
      const url = mapper(mutation.url);
      return url === mutation.url ? mutation : { ...mutation, url };
    }),
  }));
}

export function patchQueuedMutation(localId: string, patch: Partial<PendingMutation>): void {
  useOfflineStore.setState((state) => ({
    queue: state.queue.map((mutation) => (mutation.localId === localId ? { ...mutation, ...patch } : mutation)),
  }));
}

export function moveToFailed(mutation: PendingMutation, reason: string): void {
  useOfflineStore.setState((state) => ({
    queue: state.queue.filter((queued) => queued.localId !== mutation.localId),
    failed: [{ ...mutation, failedAt: Date.now(), reason }, ...state.failed].slice(0, MAX_FAILED_MUTATIONS),
  }));
}

export function clearFailedMutations(): void {
  useOfflineStore.setState({ failed: [] });
}

export function setSyncing(isSyncing: boolean): void {
  useOfflineStore.setState({ isSyncing });
}

export function setOnline(isOnline: boolean): void {
  useOfflineStore.setState({ isOnline });
}

/**
 * Wipes the cached reads of the signed-out account. Pending writes are kept on
 * purpose: they are work the person really did (series logged in the gym with no
 * signal) and dropping them loses it with no trace. An expired token or a
 * transient 5xx on /auth/me both end up here, so clearing the queue would turn a
 * routine re-login into silent data loss.
 *
 * `activeSession` is not part of `cache` and is therefore left alone too, for
 * the same reason: a workout started offline is exactly the kind of pending
 * work this function must not discard.
 *
 * Use `discardPendingWrites` when the intent really is to throw the writes away.
 */
export function clearOfflineData(): void {
  useOfflineStore.setState({ cache: {}, lastSyncAt: {} });
}

/** Drops queued and failed writes. Only for an explicit "discard" by the user. */
export function discardPendingWrites(): void {
  useOfflineStore.setState({ queue: [], failed: [] });
}
