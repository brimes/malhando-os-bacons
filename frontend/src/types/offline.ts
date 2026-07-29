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
}

/** A mutation the server refused, or that ran out of retries. Kept for inspection. */
export interface FailedMutation extends PendingMutation {
  failedAt: number;
  reason: string;
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
