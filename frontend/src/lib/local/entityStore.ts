// A reactive, in-memory mirror of one IndexedDB entity store (`food_logs`,
// `nutrition_plans`, `food_items` — see `localDb.ts`'s `STORE_NAMES`). Reads
// are synchronous once `ensureLoaded()` has resolved once (kicked off during
// boot — see `offlineBoot.ts` — so screens never observe the async gap);
// writes update the mirror first and persist to IndexedDB after, which is
// what lets `useLocal.ts` hand a screen its data with no `await` in the
// render path.
//
// This is the "collection module" primitive `lib/local/repo/*.ts` builds on —
// one `EntityCache` per store, one repo module per collection, per the slice
// description ("um módulo por coleção usada aqui").

import { deleteRecord, getAll, putAllReplacing, putRecord, type StoreName } from '../localDb';

type Listener = () => void;

interface WithId {
  id: number;
}

export class EntityCache<T extends WithId> {
  private items = new Map<number, T>();
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;
  private listeners = new Set<Listener>();
  /**
   * Bumped on every change. `useLocal.ts` memoizes its `getSnapshot()` off
   * this instead of recomputing (and returning a fresh array reference) on
   * every call — `useSyncExternalStore` re-renders forever if `getSnapshot`
   * never returns the same reference twice for an unchanged store.
   */
  private revision = 0;
  /** Memoized `[...items.values()]`, recomputed only when `revision` moves — see `getSnapshot`. */
  private snapshot: T[] | null = null;
  private snapshotRevision = -1;

  constructor(private readonly store: StoreName) {}

  getRevision(): number {
    return this.revision;
  }

  /**
   * Same array reference across calls until the next write — what
   * `useLocal.ts`'s `useSyncExternalStore` needs `getSnapshot()` to return,
   * or it re-renders forever (every call to `[...items.values()]` is a new
   * array even when nothing changed).
   */
  getSnapshot(): T[] {
    if (this.snapshot === null || this.snapshotRevision !== this.revision) {
      this.snapshot = this.getAll();
      this.snapshotRevision = this.revision;
    }
    return this.snapshot;
  }

  /** Idempotent: safe to call from every repo function and from boot. */
  ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = getAll<T>(this.store)
      .then((records) => {
        for (const record of records) this.items.set(record.id, record);
        this.loaded = true;
      })
      .catch((error) => {
        // Same tradeoff as `offlineBoot.ts`: an empty cache the app can still
        // write into beats a screen stuck waiting on IndexedDB forever.
        console.error(`[local] Falha ao carregar "${this.store}" do IndexedDB.`, error);
        this.loaded = true;
      })
      .finally(() => {
        this.loadingPromise = null;
        this.notify();
      });
    return this.loadingPromise;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getAll(): T[] {
    return [...this.items.values()];
  }

  get(id: number): T | undefined {
    return this.items.get(id);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
  }

  /** Optimistic local write: updates the mirror (and notifies) before IndexedDB confirms. */
  async put(item: T): Promise<void> {
    this.items.set(item.id, item);
    this.notify();
    await putRecord(this.store, item);
  }

  async remove(id: number): Promise<void> {
    if (!this.items.has(id)) return;
    this.items.delete(id);
    this.notify();
    await deleteRecord(this.store, id);
  }

  /**
   * Moves a record from `oldId` to `newId` — the mirror and IndexedDB both —
   * used once a create made offline learns its real server id. A no-op when
   * `oldId` is not present (already remapped, or never was this device's).
   */
  async remapId(oldId: number, newId: number): Promise<void> {
    const item = this.items.get(oldId);
    if (!item) return;
    this.items.delete(oldId);
    const remapped = { ...item, id: newId };
    this.items.set(newId, remapped);
    this.notify();
    await deleteRecord(this.store, oldId);
    await putRecord(this.store, remapped);
  }

  /**
   * Upserts every record in `items`, one at a time, by id — never `clear()`.
   * For a pull that reconciles in place (nutrition plans): see the
   * `CLAUDE.md`/spec rule this exists to honor.
   */
  async upsertMany(items: T[]): Promise<void> {
    if (items.length === 0) return;
    for (const item of items) {
      this.items.set(item.id, item);
      await putRecord(this.store, item);
    }
    this.notify();
  }

  /**
   * Replaces every record `isWithinWindow(item)` accepts with `items`,
   * leaving anything it rejects (outside the window) untouched. Used by a
   * sliding-window pull (`food_logs`): a full refetch of the window is what
   * makes a server-side delete inside it disappear locally with no
   * tombstone, while a record outside the window (older history) is left
   * exactly as it was.
   */
  async replaceWindow(items: T[], isWithinWindow: (item: T) => boolean): Promise<void> {
    const outsideWindow = this.getAll().filter((item) => !isWithinWindow(item));
    const next = new Map<number, T>();
    for (const item of outsideWindow) next.set(item.id, item);
    for (const item of items) next.set(item.id, item);
    this.items = next;
    this.notify();
    await putAllReplacing(this.store, this.getAll());
  }

  /**
   * Replaces the whole collection wholesale — the one case a full `clear()`
   * is correct: a complete-set pull (personal foods) where a record missing
   * from the response really was deleted server-side, not just outside a
   * window. Never used for an entity with an in-place reconciliation rule
   * (nutrition plans) — see `upsertMany`.
   */
  async replaceAll(items: T[]): Promise<void> {
    this.items = new Map(items.map((item) => [item.id, item]));
    this.notify();
    await putAllReplacing(this.store, items);
  }
}
