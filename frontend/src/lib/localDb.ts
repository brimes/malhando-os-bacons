// Raw IndexedDB access for the offline layer. Nothing here knows about
// `PendingMutation`, the offline store, or any screen — it is a thin,
// promise-based wrapper around the browser API and the schema from the spec.
// Entity stores (`workouts`, `workout_sets`, `food_logs`, `food_items`,
// `training_plans`, `nutrition_plans`) are created here but sit unused this
// slice: they are populated by later slices. What is in use now is `outbox`
// and `meta` — see `offlineDbStorage.ts`.

export const DB_NAME = 'mob';
export const DB_VERSION = 1;

export const STORE_NAMES = [
  'workouts',
  'workout_sets',
  'food_logs',
  'food_items',
  'training_plans',
  'nutrition_plans',
  'outbox',
  'meta',
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

/** Row shape of the `meta` store — a generic key/value bucket. */
export interface MetaRow {
  key: string;
  value: unknown;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao ler/escrever no IndexedDB.'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Transação do IndexedDB falhou.'));
    tx.onabort = () => reject(tx.error ?? new Error('Transação do IndexedDB abortada.'));
  });
}

function createStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('workouts')) {
    const store = db.createObjectStore('workouts', { keyPath: 'id' });
    store.createIndex('date', 'date');
    store.createIndex('client_session_id', 'client_session_id');
    store.createIndex('training_plan_day_id', 'training_plan_day_id');
  }
  if (!db.objectStoreNames.contains('workout_sets')) {
    const store = db.createObjectStore('workout_sets', { keyPath: 'id' });
    store.createIndex('workout_id', 'workout_id');
    store.createIndex('client_set_id', 'client_set_id');
  }
  if (!db.objectStoreNames.contains('food_logs')) {
    const store = db.createObjectStore('food_logs', { keyPath: 'id' });
    store.createIndex('date', 'date');
    store.createIndex('client_log_id', 'client_log_id');
  }
  if (!db.objectStoreNames.contains('food_items')) {
    const store = db.createObjectStore('food_items', { keyPath: 'id' });
    store.createIndex('name', 'name');
  }
  if (!db.objectStoreNames.contains('training_plans')) {
    db.createObjectStore('training_plans', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('nutrition_plans')) {
    db.createObjectStore('nutrition_plans', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('outbox')) {
    const store = db.createObjectStore('outbox', { keyPath: 'localId' });
    store.createIndex('createdAt', 'createdAt');
    store.createIndex('entity', 'entity');
  }
  if (!db.objectStoreNames.contains('meta')) {
    db.createObjectStore('meta', { keyPath: 'key' });
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Opens (and, on first run, creates) the `mob` database. Memoized: every caller shares one connection. */
export function openLocalDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const attempt: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponível neste ambiente.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => createStores(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao abrir o IndexedDB.'));
    // Another tab holding an older connection open during a version bump. Not
    // reachable at version 1 with no prior version, kept for when a future
    // slice bumps `DB_VERSION`.
    request.onblocked = () => reject(new Error('Abertura do IndexedDB bloqueada por outra aba.'));
  });
  dbPromise = attempt.catch((error) => {
    // Do not memoize a failed open — a later call (e.g. after the user grants
    // storage permission) should get a fresh attempt instead of the same
    // rejected promise forever.
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openLocalDb();
  const tx = db.transaction(store, 'readonly');
  const result = await requestToPromise(tx.objectStore(store).getAll() as IDBRequest<T[]>);
  await txDone(tx);
  return result;
}

/**
 * Single-record helpers on top of the transaction primitives above. Added for
 * the entity repos (`lib/local/repo/*.ts`, see `lib/local/entityStore.ts`) —
 * `getAll`/`clearStore`/`runReadWriteTransaction` alone meant every write went
 * through a bespoke transaction, which is exactly the boilerplate this exists
 * to remove.
 */
export async function getRecord<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openLocalDb();
  const tx = db.transaction(store, 'readonly');
  const result = await requestToPromise(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
  await txDone(tx);
  return result;
}

export async function putRecord<T>(store: StoreName, value: T): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await txDone(tx);
}

export async function deleteRecord(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await txDone(tx);
}

/**
 * Replaces every record of `store` with `values` in one transaction — used by
 * a pull that refetches a whole collection (e.g. personal foods) rather than a
 * sliding window of it. Never used for `food_logs`: that pull writes by id
 * within its date window instead, see `lib/local/repo/foodLogs.ts`.
 */
export async function putAllReplacing<T>(store: StoreName, values: T[]): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(store, 'readwrite');
  const objectStore = tx.objectStore(store);
  objectStore.clear();
  for (const value of values) objectStore.put(value);
  await txDone(tx);
}

export async function getAllKeys(store: StoreName): Promise<IDBValidKey[]> {
  const db = await openLocalDb();
  const tx = db.transaction(store, 'readonly');
  const result = await requestToPromise(tx.objectStore(store).getAllKeys());
  await txDone(tx);
  return result;
}

export async function clearStore(store: StoreName): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await txDone(tx);
}

/**
 * Runs `work` inside one read-write transaction over `stores`, so a partial
 * write (e.g. half the outbox reconciled) can never be observed — either every
 * `put`/`delete` inside `work` lands, or none of them do.
 */
export async function runReadWriteTransaction(
  stores: StoreName[],
  work: (tx: IDBTransaction) => void,
): Promise<void> {
  const db = await openLocalDb();
  const tx = db.transaction(stores, 'readwrite');
  work(tx);
  await txDone(tx);
}

/**
 * Dumps every object store for manual inspection. Used by QA through
 * `window.__localDbForTests` (see `offlineDbStorage.ts`) — never shipped, see
 * that module for the `import.meta.env.DEV` guard.
 */
export async function dumpAllStores(): Promise<Record<StoreName, unknown[]>> {
  const entries = await Promise.all(STORE_NAMES.map(async (store) => [store, await getAll(store)] as const));
  return Object.fromEntries(entries) as Record<StoreName, unknown[]>;
}
