// Types used by the offline layer (src/lib/offline*.ts). They live in their own
// file instead of src/types/index.ts so the offline work stays self-contained.

/** HTTP methods that change server state and can therefore be queued. */
export type MutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Identifies one cached resource snapshot.
 *
 * GET responses always use the key produced by `resourceKeyForRequest`
 * ("get:/workouts?date=2026-07-27"), so the axios interceptor and the zustand
 * stores share a single entry per URL instead of keeping two copies of the same
 * payload in localStorage.
 */
export type ResourceKey = string;

export interface CacheEntry<T = unknown> {
  data: T;
  /** Epoch ms of when this snapshot came from the server. */
  updatedAt: number;
}

/** A write that could not reach the server and waits for the connection to return. */
export interface PendingMutation {
  localId: string;
  method: MutationMethod;
  url: string;
  params?: Record<string, unknown>;
  body?: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /**
   * Negative id handed to the entity this POST created while offline. Kept so the
   * replay can pair it with the real id the server answers with, and rewrite the
   * mutations still queued behind it (the series of a workout started offline all
   * point at `/workouts/-1/...` until that swap happens).
   */
  localEntityId?: number;
  /**
   * Training plan day this mutation's workout belongs to. Only ever set on a
   * queued `finish`/`complete` (see `dayIdForActiveWorkout` in
   * `workoutSession.ts`), captured at the moment it is enqueued because that
   * is the only time it is guaranteed to still be known — the session that
   * knew it may be cleared, or its start may already have synced and left the
   * queue, by the time anything reads this mutation again.
   */
  trainingPlanDayId?: number;
}

/** A mutation the server refused, or that ran out of retries. Kept for inspection. */
export interface FailedMutation extends PendingMutation {
  failedAt: number;
  reason: string;
}

/**
 * Everything the offline store persists across restarts — the rest
 * (`isOnline`, `isSyncing`, `isHydrated`) describes this instant, never the
 * last run. Lives here, not in `offlineStore.ts`, so `offlineDbStorage.ts`
 * (the IndexedDB-backed persistence engine) can share the shape without
 * importing the store module itself and creating a cycle: the store imports
 * the storage engine, not the other way around.
 */
export interface PersistedOfflineState {
  cache: Record<ResourceKey, CacheEntry>;
  lastSyncAt: Record<ResourceKey, number>;
  queue: PendingMutation[];
  failed: FailedMutation[];
  nextLocalId: number;
  /** An `ActiveWorkout` from `../types`, kept as `unknown` — see `offlineStore.ts`. */
  activeSession: unknown;
  planDays: Record<number, CacheEntry>;
}

/**
 * Shape returned by `useOfflineStatus()` — the contract other screens consume.
 * The first four fields are the required ones; the rest are extras a status
 * banner tends to need.
 */
export interface OfflineStatus {
  isOnline: boolean;
  /** Epoch ms of the most recent successful read from the server, null if it never synced. */
  lastSyncAt: number | null;
  pendingCount: number;
  /** Flushes the queue and revalidates every resource the app has read so far. */
  syncNow: () => Promise<void>;

  isSyncing: boolean;
  failedCount: number;
  failedMutations: FailedMutation[];
  /** Epoch ms of the last sync of a single resource, e.g. `resourceKeyForRequest('/workouts')`. */
  lastSyncAtFor: (resourceKey: ResourceKey) => number | null;
  /** Drops the mutations the server refused, so the badge can be cleared. */
  discardFailedMutations: () => void;
}
