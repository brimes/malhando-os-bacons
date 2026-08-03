// The IndexedDB-backed persistence engine for `useOfflineStore` (see
// `offlineStore.ts`). Everything here works with plain data — no zustand
// import — so it stays usable from `offlineBoot.ts` (which needs the
// migration functions before the store exists) without creating a cycle.
//
// Two things live in the `mob` database this slice actually uses:
//  - `outbox`: one record per queued mutation, keyed by `localId`, so QA and
//    a future slice can inspect/filter individual entries instead of one
//    opaque blob.
//  - `meta`: everything else that is not disposable cache — `activeSession`,
//    `planDays`, `nextLocalId`, `failed` — plus the disposable `cache` and
//    `lastSyncAt`, which have no dedicated store (they are not entities, and
//    the entity stores are unused until slices 4/6 populate them) but still
//    need somewhere to live between restarts. `meta`'s `key`-keyed shape fits
//    a generic bucket like that as well as it fits the durable fields.

import type { FailedMutation, PendingMutation, PersistedOfflineState } from '../types/offline';
import { clearStore, dumpAllStores, getAll, runReadWriteTransaction, type MetaRow } from './localDb';
import { normalizePath } from './requestPath';

/** Matches zustand's `PersistStorage<S>` shape without importing zustand here — this module has no framework dependency on purpose. */
export interface PersistStorageLike<S> {
  getItem: (name: string) => Promise<{ state: S; version?: number } | null>;
  setItem: (name: string, value: { state: S; version?: number }) => Promise<void>;
  removeItem: (name: string) => Promise<void>;
}

/** `outbox` row: a `PendingMutation` plus two derived, non-`PendingMutation` fields. */
interface OutboxRecord extends PendingMutation {
  /** First path segment of `url` (e.g. `workouts`, `nutrition`) — index only, never read back into `PendingMutation`. */
  entity: string;
  /**
   * Position in `state.queue` at the moment it was written. `getAll()` on an
   * IndexedDB store returns rows ordered by primary key (`localId`, a string),
   * not insertion order — and `localId` sorts lexicographically, not
   * chronologically (`"set-1"` < `"start-1"`). `runFlush` in `offlineSync.ts`
   * replays strictly FIFO because a later mutation can depend on an earlier
   * one (a workout's sets behind its start); losing that order would replay
   * them out of sequence with no error, exactly the silent corruption this
   * slice exists to avoid. `seq` is what `readPersistedOfflineState` sorts by
   * to restore it — see there.
   */
  seq: number;
}

/** First path segment, used only to populate the `entity` index on `outbox`. */
function deriveEntity(url: string): string {
  const segment = normalizePath(url).split('/').filter(Boolean)[0];
  return segment || 'unknown';
}

function toOutboxRecord(mutation: PendingMutation, seq: number): OutboxRecord {
  return { ...mutation, entity: deriveEntity(mutation.url), seq };
}

/** Drops `entity` and `seq` — both derived, neither a field of `PendingMutation`, and must not leak back into the queue. */
function fromOutboxRecord(record: OutboxRecord): PendingMutation {
  const { entity: _entity, seq: _seq, ...mutation } = record;
  return mutation;
}

const META_KEYS = ['cache', 'lastSyncAt', 'failed', 'nextLocalId', 'activeSession', 'planDays'] as const;

/** Reads everything `useOfflineStore` persists, or `null` when the database has nothing yet (fresh install). */
export async function readPersistedOfflineState(): Promise<PersistedOfflineState | null> {
  const [outboxRecords, metaRows] = await Promise.all([
    getAll<OutboxRecord>('outbox'),
    getAll<MetaRow>('meta'),
  ]);
  if (outboxRecords.length === 0 && metaRows.length === 0) return null;

  const meta = new Map(metaRows.map((row) => [row.key, row.value]));
  // `seq`, not `localId` (the primary key `getAll()` naturally orders by) —
  // see the field comment on `OutboxRecord.seq`.
  const orderedOutbox = [...outboxRecords].sort((a, b) => a.seq - b.seq);
  return {
    cache: (meta.get('cache') as PersistedOfflineState['cache']) ?? {},
    lastSyncAt: (meta.get('lastSyncAt') as PersistedOfflineState['lastSyncAt']) ?? {},
    queue: orderedOutbox.map(fromOutboxRecord),
    failed: (meta.get('failed') as FailedMutation[]) ?? [],
    nextLocalId: (meta.get('nextLocalId') as number) ?? -1,
    activeSession: meta.has('activeSession') ? meta.get('activeSession') : null,
    planDays: (meta.get('planDays') as PersistedOfflineState['planDays']) ?? {},
  };
}

/**
 * Writes the whole persisted state in one read-write transaction, so a crash
 * mid-write can never leave `outbox` and `meta` disagreeing. `outbox` is
 * replaced wholesale (`clear()` then `put()` every current entry) rather than
 * diffed against a separately-read key list: zustand's `persist` does not
 * serialize calls to an async `storage.setItem` (two state changes in quick
 * succession can produce two overlapping calls here), and a diff computed
 * from a `getAllKeys()` read done *outside* this transaction could act on a
 * key list that is already stale by the time the delete/put runs. `clear()`
 * inside the same transaction as the `put()`s has no such window — IndexedDB
 * queues transactions against the same store, so whichever call's transaction
 * commits second simply sees the first call's result already applied.
 */
export async function writePersistedOfflineState(state: PersistedOfflineState): Promise<void> {
  await runReadWriteTransaction(['outbox', 'meta'], (tx) => {
    const outboxStore = tx.objectStore('outbox');
    outboxStore.clear();
    state.queue.forEach((mutation, seq) => outboxStore.put(toOutboxRecord(mutation, seq)));

    const metaStore = tx.objectStore('meta');
    const values: Record<(typeof META_KEYS)[number], unknown> = {
      cache: state.cache,
      lastSyncAt: state.lastSyncAt,
      failed: state.failed,
      nextLocalId: state.nextLocalId,
      activeSession: state.activeSession,
      planDays: state.planDays,
    };
    for (const key of META_KEYS) metaStore.put({ key, value: values[key] } satisfies MetaRow);
  });
}

// --- migration between localStorage and IndexedDB ---------------------------

const LEGACY_STORAGE_KEY = 'mob-offline';

/** Fields the old localStorage blob carried that this migration deliberately drops — see the module comment on `migrateLegacyLocalStorageToIndexedDb`. */
type LegacyPersistedState = PersistedOfflineState;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only the fields worth carrying over from the old blob — see the slice description for why `cache`/`lastSyncAt` are not among them. */
function pickMigratableFields(raw: unknown): Pick<LegacyPersistedState, 'queue' | 'failed' | 'activeSession' | 'nextLocalId' | 'planDays'> {
  const state = isPlainObject(raw) ? raw : {};
  return {
    queue: Array.isArray(state.queue) ? (state.queue as PendingMutation[]) : [],
    failed: Array.isArray(state.failed) ? (state.failed as FailedMutation[]) : [],
    activeSession: 'activeSession' in state ? state.activeSession : null,
    nextLocalId: typeof state.nextLocalId === 'number' ? state.nextLocalId : -1,
    planDays: isPlainObject(state.planDays) ? (state.planDays as LegacyPersistedState['planDays']) : {},
  };
}

/**
 * One-way, one-time migration of the *durable* fields from the old localStorage
 * blob into IndexedDB. Deliberately does **not** carry over `cache` or
 * `lastSyncAt`: both are snapshots of GET responses, re-fetchable from the
 * server by definition, and converting them into the new entity stores is the
 * job of slices 4 and 6 — not this one.
 *
 * Idempotent and safe to call on every boot where the desired engine is
 * `indexeddb` (see `offlineBoot.ts`): a no-op when `mob-offline` is absent,
 * and treats localStorage as authoritative whenever it *is* present — which
 * is also what happens after a revert-then-re-enable cycle (see
 * `exportIndexedDbToLegacyLocalStorage`), so one function covers both "first
 * ever boot on this device" and "flag flipped back on".
 *
 * Only removes the localStorage key after `writePersistedOfflineState`
 * resolves — losing the write and the key at the same time would be exactly
 * the silent data loss this whole slice exists to avoid.
 */
export async function migrateLegacyLocalStorageToIndexedDb(): Promise<void> {
  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (raw === null) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupted value: nothing safe to migrate, but leaving it in place would
    // just fail to parse again on every future boot. Drop it and move on with
    // an empty IndexedDB state, same as a fresh install.
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return;
  }
  const legacyState = isPlainObject(parsed) ? parsed.state : undefined;
  const migratable = pickMigratableFields(legacyState);

  const current = await readPersistedOfflineState();
  await writePersistedOfflineState({
    cache: current?.cache ?? {},
    lastSyncAt: current?.lastSyncAt ?? {},
    ...migratable,
  });

  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

/**
 * The reverse of `migrateLegacyLocalStorageToIndexedDb`, run when the storage
 * engine flag is switched *off* IndexedDB (see `offlineBoot.ts`). IndexedDB is
 * authoritative at the moment the flag flips, so this overwrites whatever is
 * in `mob-offline` with what IndexedDB currently holds — including `cache`
 * and `lastSyncAt`, unlike the forward direction, because going back to the
 * old engine means `quotaAwareStorage` needs its full expected shape, not
 * just the durable fields.
 */
export async function exportIndexedDbToLegacyLocalStorage(): Promise<void> {
  const state = await readPersistedOfflineState();
  const payload = {
    state: state ?? { cache: {}, lastSyncAt: {}, queue: [], failed: [], nextLocalId: -1, activeSession: null, planDays: {} },
    version: 1,
  };
  window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(payload));
}

// --- zustand `persist` adapter -----------------------------------------------

/**
 * The `storage` handed to `persist()` in `offlineStore.ts` when the storage
 * engine flag (see `offlineStorageEngine.ts`) selects IndexedDB. `name` is
 * ignored — unlike `localStorage.setItem(name, json)`, this store does not
 * multiplex on a single string key, so there is nothing to namespace by.
 *
 * Failures (IndexedDB disabled, quota exceeded, private-browsing restrictions
 * on some old WebViews) are swallowed rather than thrown: the same philosophy
 * as `quotaAwareStorage`'s `persistenceDisabled` — the app keeps running
 * without durability rather than crashing every reducer that touches the
 * store. `console.error` is the only trace, same tradeoff as before.
 */
/**
 * Serializes every `setItem`/`removeItem` below onto one promise chain, so a
 * write started (and awaited) later cannot finish — and commit to
 * IndexedDB — before one started earlier. Without this, zustand's `persist`
 * fires an independent `setItem(fullState)` on *every* subscribed state
 * change (there is no debouncing, and each call writes the whole state, not
 * a diff); two calls a few state changes apart race each other freely, and
 * IndexedDB gives no ordering guarantee between separate transactions on the
 * same store. Losing that race means the earlier (staler) full-state
 * snapshot commits *after* the later one and silently erases whatever the
 * later write had that the earlier one did not.
 */
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(work: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(work, work);
  return writeQueue;
}

/**
 * True once `offlineBoot.ts` has restored this store from disk (or given up
 * trying). `false` from module load, on purpose: `skipHydration: true` in
 * `offlineStore.ts` only stops `persist` from *reading* disk on its own before
 * `offlineBoot.ts` explicitly calls `rehydrate()` — it does nothing to stop
 * `persist` *writing* to disk in the meantime. And something always does,
 * before rehydration finishes: `offlineStore.ts`'s own `setOnline(...)` call
 * at module load, run synchronously, long before the async `rehydrate()`
 * settles. That `setState` still carries the pristine, not-yet-restored
 * `cache`/`queue`/... — and persist's write subscription fires on it exactly
 * like any other change, writing `{ cache: {}, queue: [], ... }` straight
 * over whatever the *previous* session had. If that commits before
 * `rehydrate()`'s own read (a real, reproduced race — write-order
 * serialization above does not help, since `getItem()` isn't part of that
 * queue at all), `rehydrate()` faithfully restores this now-just-erased
 * snapshot into memory: hydration "succeeds", into emptiness, every pending
 * mutation and cached read from the previous session gone with no error
 * anywhere. Suppressing writes until hydration is known to have finished — see
 * `markPersistHydrated`, called once by `offlineBoot.ts` right after
 * `rehydrate()` resolves — closes that window: the only snapshots that ever
 * reach disk are ones taken *after* this device's own history was restored
 * into memory first.
 */
let hydrated = false;

/** Called once by `offlineBoot.ts` right after `useOfflineStore.persist.rehydrate()` settles. */
export function markPersistHydrated(): void {
  hydrated = true;
}

export const indexedDbPersistStorage: PersistStorageLike<PersistedOfflineState> = {
  getItem: async () => {
    try {
      const state = await readPersistedOfflineState();
      return state === null ? null : { state, version: 1 };
    } catch (error) {
      console.error('[offline] Falha ao ler o IndexedDB, começando com o estado em memória.', error);
      return null;
    }
  },
  setItem: (_name, value) => {
    if (!hydrated) return Promise.resolve();
    return enqueueWrite(async () => {
      try {
        await writePersistedOfflineState(value.state);
      } catch (error) {
        console.error('[offline] Falha ao gravar no IndexedDB; a alteração ficou só em memória.', error);
      }
    });
  },
  removeItem: () => {
    if (!hydrated) return Promise.resolve();
    return enqueueWrite(async () => {
      try {
        await Promise.all([clearStore('outbox'), clearStore('meta')]);
      } catch (error) {
        console.error('[offline] Falha ao limpar o IndexedDB.', error);
      }
    });
  },
};

// --- test hook ---------------------------------------------------------------

/**
 * Exposes the IndexedDB contents to QA: `window.__localDbForTests.dump()`
 * inspects every object store, same spirit as `__offlineStoreForTests` for the
 * in-memory Zustand state. `import.meta.env.DEV` keeps this out of anything
 * shipped — a production build tree-shakes the whole block away.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __localDbForTests?: { dump: () => Promise<unknown> } }).__localDbForTests = {
    dump: dumpAllStores,
  };
}
