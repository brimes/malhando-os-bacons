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
// `planDays` (below) is durable, not disposable like `cache` — but durable
// does not mean unbounded. A full plan snapshot per day, never pruned, grows
// with every day ever opened on this device and was landing in the
// quota-rescue payload in `quotaAwareStorage` with no ceiling of its own. 20-30
// days covers every plan this app generates several times over.
const MAX_PLAN_DAYS = 30;

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
  /**
   * Training plan days this device has actually visited, keyed by day id. Same
   * treatment as `activeSession` and for the same reason: `findCachedPlanDay`
   * (`lib/workoutSession.ts`) needs a day to still be here after the generic
   * `cache` has been pruned or wiped, or a session assembled offline has
   * nowhere to read its exercises from. Written in place, one day at a time —
   * never cleared in bulk — because a day that drops out of the plan on the
   * server must stay available until the server actually confirms that,
   * otherwise a session already pointing at it would be orphaned. See
   * `persistPlanDaysDurable` / `findCachedPlanDay`.
   *
   * Bounded at `MAX_PLAN_DAYS`, LRU by `updatedAt` like `cache` — but with
   * the day backing the current `activeSession`, and every day in the batch
   * just written, pinned so eviction can never orphan a session mid-workout.
   * See `writeLocalPlanDays`.
   */
  planDays: Record<number, CacheEntry>;
  isOnline: boolean;
  isSyncing: boolean;
}

/** Everything that is worth writing to localStorage; the rest is per-session. */
type PersistedOfflineState = Pick<
  OfflineStoreState,
  'cache' | 'lastSyncAt' | 'queue' | 'failed' | 'nextLocalId' | 'activeSession' | 'planDays'
>;

const initialState: OfflineStoreState = {
  cache: {},
  lastSyncAt: {},
  queue: [],
  failed: [],
  nextLocalId: -1,
  activeSession: null,
  planDays: {},
  isOnline: isNetworkOnline(),
  isSyncing: false,
};

// Guards the eviction path below against the write it triggers itself.
let isEvicting = false;
// Set once localStorage has rejected a write even the smallest rescue payload
// (queue + failed only) couldn't survive — DOM storage disabled, or the site's
// storage blocked outright. At that point every stage below throws, every
// time, so retrying the whole 3-stage dance (two JSON.stringify of the entire
// state) on the next write would just throw again — out of `writeCache` on
// every GET and `pushToQueue` on every queued mutation, both uncaught. Once
// this is true, `setItem` gives up immediately and the app keeps running
// without persistence instead of every read and write starting to fail.
let persistenceDisabled = false;

// `planDays` changed shape mid-branch (it used to hold `{plan, day}` raw, now
// `{data, updatedAt}` like `cache` — see `readLocalPlanDay`). No shipped
// release ever wrote the old shape, only this branch's intermediate builds
// did, but a device that ran one has entries `readLocalPlanDay` silently
// can't read. Bumping this and discarding `planDays` on `migrate` (below) is
// free: it is re-fetched from the server like any other cache entry. The
// rescue payloads inside `quotaAwareStorage` write this same version — if
// they stayed at the old one, a rescue write would look stale to `persist`
// and get migrated (i.e. wiped of `planDays`) again on the very next boot.
const PERSISTED_STATE_VERSION = 1;

const quotaAwareStorage = createJSONStorage<PersistedOfflineState>(() => ({
  getItem: (name) => window.localStorage.getItem(name),
  setItem: (name, value) => {
    if (isEvicting || persistenceDisabled) return;
    try {
      window.localStorage.setItem(name, value);
      return;
    } catch {
      // fall through to recovery below
    }
    // Quota blown. Cached reads can be fetched again from the server, pending
    // mutations cannot — so the caches go and the queue stays. `activeSession`
    // goes with the queue: a session opened offline is exactly the kind of
    // unrecoverable state this recovery path must not touch, the same way it
    // does not touch `queue` or `failed`.
    isEvicting = true;
    try {
      const { queue, failed, nextLocalId, activeSession, planDays } = useOfflineStore.getState();
      try {
        window.localStorage.setItem(
          name,
          JSON.stringify({ state: { cache: {}, lastSyncAt: {}, queue, failed, nextLocalId, activeSession, planDays }, version: PERSISTED_STATE_VERSION }),
        );
        useOfflineStore.setState({ cache: {}, lastSyncAt: {} });
      } catch {
        // Even the bounded rescue payload didn't fit. `planDays` is capped
        // (see `MAX_PLAN_DAYS`) but still holds full plan snapshots, not just
        // ids, so of what is left it is the biggest thing that is not the
        // queue — drop it too before giving up on the queue itself.
        try {
          window.localStorage.setItem(
            name,
            JSON.stringify({ state: { cache: {}, lastSyncAt: {}, queue, failed, nextLocalId, activeSession, planDays: {} }, version: PERSISTED_STATE_VERSION }),
          );
          useOfflineStore.setState({ cache: {}, lastSyncAt: {}, planDays: {} });
        } catch {
          try {
            window.localStorage.removeItem(name);
          } catch {
            // Even clearing failed: localStorage is rejecting everything, not
            // just this write over quota (DOM storage disabled, site storage
            // blocked). Stop trying — see `persistenceDisabled` above.
            persistenceDisabled = true;
          }
          // Disk is empty (or storage is gone) either way; keep memory in
          // step so the next write doesn't reassemble the same `planDays`
          // payload for nothing.
          useOfflineStore.setState({ cache: {}, lastSyncAt: {}, planDays: {} });
        }
      }
    } finally {
      isEvicting = false;
    }
  },
  removeItem: (name) => window.localStorage.removeItem(name),
}));

export const useOfflineStore = create<OfflineStoreState>()(
  persist(() => initialState, {
    name: STORAGE_KEY,
    storage: quotaAwareStorage,
    version: PERSISTED_STATE_VERSION,
    migrate: (persistedState) => ({
      ...(persistedState as PersistedOfflineState),
      planDays: {},
    }),
    // isOnline/isSyncing describe this instant, never the last run.
    partialize: (state) => ({
      cache: state.cache,
      lastSyncAt: state.lastSyncAt,
      queue: state.queue,
      failed: state.failed,
      nextLocalId: state.nextLocalId,
      activeSession: state.activeSession,
      planDays: state.planDays,
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

/**
 * The snapshot for one training plan day, or `undefined` when this device has
 * never visited it. Lives outside `cache` — see the field comment on
 * `OfflineStoreState` — so it is never pruned by the generic cache path.
 */
export function readLocalPlanDay<T = unknown>(dayId: number): T | undefined {
  return useOfflineStore.getState().planDays[dayId]?.data as T | undefined;
}

/** The day id backing the current `activeSession`, or `undefined` when none is running. */
function activeSessionPlanDayId(state: OfflineStoreState): number | undefined {
  const session = state.activeSession as { workout?: { training_plan_day_id?: number } } | null;
  return session?.workout?.training_plan_day_id;
}

/**
 * Drops the least recently written days once `planDays` exceeds `MAX_PLAN_DAYS`.
 * `pinned` is never evicted no matter how old — it always includes the day
 * behind the running session (evicting it mid-workout would reintroduce the
 * exact bug `planDays` exists to prevent) plus every day in the batch just
 * written, so a multi-day plan fetch cannot evict one of its own days to make
 * room for another.
 */
function prunePlanDays(planDays: Record<number, CacheEntry>, pinned: Set<number>): Record<number, CacheEntry> {
  const keys = Object.keys(planDays).map(Number);
  if (keys.length <= MAX_PLAN_DAYS) return planDays;
  const evictable = keys
    .filter((id) => !pinned.has(id))
    .sort((a, b) => (planDays[a]?.updatedAt ?? 0) - (planDays[b]?.updatedAt ?? 0));
  const pruned = { ...planDays };
  let toRemove = keys.length - MAX_PLAN_DAYS;
  for (const id of evictable) {
    if (toRemove <= 0) break;
    delete pruned[id];
    toRemove -= 1;
  }
  return pruned;
}

/**
 * Writes (or overwrites) the snapshot for a batch of days in a single
 * `setState` — one persisted write instead of one per day, see
 * `persistPlanDaysDurable`. Never removes entries for days outside the batch:
 * a day that disappears from the plan on the server must stay here, reachable,
 * until the server actually confirms that; see the field comment on
 * `OfflineStoreState`. Bounded by `prunePlanDays`.
 */
export function writeLocalPlanDays(entries: Array<readonly [dayId: number, snapshot: unknown]>): void {
  if (entries.length === 0) return;
  useOfflineStore.setState((state) => {
    const updatedAt = Date.now();
    const planDays = { ...state.planDays };
    const justWritten = new Set<number>();
    for (const [dayId, snapshot] of entries) {
      planDays[dayId] = { data: snapshot, updatedAt };
      justWritten.add(dayId);
    }
    const activeDayId = activeSessionPlanDayId(state);
    if (activeDayId !== undefined) justWritten.add(activeDayId);
    return { planDays: prunePlanDays(planDays, justWritten) };
  });
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
 * `planDays` IS cleared here, unlike `activeSession`. It holds no pending work
 * of its own — it is a read cache, same category as `cache`, just shelved
 * separately so pruning cannot touch it. Keeping a previous account's plan
 * days around after logout would let whoever signs in next on this device see
 * (and offline-start) a stranger's workout day.
 *
 * Use `discardPendingWrites` when the intent really is to throw the writes away.
 */
export function clearOfflineData(): void {
  useOfflineStore.setState({ cache: {}, lastSyncAt: {}, planDays: {} });
}

/** Drops queued and failed writes. Only for an explicit "discard" by the user. */
export function discardPendingWrites(): void {
  useOfflineStore.setState({ queue: [], failed: [] });
}

// --- test hook ---------------------------------------------------------------

/**
 * Exposes the store to QA for manual offline testing: inspecting `queue` from
 * the devtools console and writing 61+ throwaway cache entries to force
 * `pruneCache`'s LRU eviction without waiting for real traffic to produce it.
 * `import.meta.env.DEV` keeps this out of anything actually shipped — a
 * production build has this whole block tree-shaken away, not just hidden.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __offlineStoreForTests?: typeof useOfflineStore }).__offlineStoreForTests = useOfflineStore;
}
