// The reversal flag for the localStorage -> IndexedDB migration. Deliberately
// tiny and dependency-free: it is read once, at module load, by both
// `offlineStore.ts` (to pick which `PersistStorage` to hand `persist()`) and
// `offlineBoot.ts` (to decide which direction, if any, to reconcile on boot).
//
// This is a kill switch, not a live user-facing toggle: flipping it takes
// effect on the next app start, not the current one. `offlineBoot.ts` is what
// makes flipping it lossless — see its module comment.

const FLAG_KEY = 'mob-storage-engine';
/** The engine actually reconciled-to as of the last boot — see `offlineBoot.ts`. */
const ACTIVE_ENGINE_KEY = 'mob-storage-engine-active';

export type StorageEngine = 'indexeddb' | 'localstorage';

function readFlag(key: string): StorageEngine | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === 'indexeddb' || raw === 'localstorage' ? raw : null;
  } catch {
    return null;
  }
}

/** The engine the app should use this run. Defaults to IndexedDB — this slice's whole point. */
export function getStorageEngineFlag(): StorageEngine {
  return readFlag(FLAG_KEY) ?? 'indexeddb';
}

/** Sets the flag for the *next* app start. Does not migrate anything itself — `offlineBoot.ts` does that on the next boot. */
export function setStorageEngineFlag(engine: StorageEngine): void {
  window.localStorage.setItem(FLAG_KEY, engine);
}

/** The engine that was actually reconciled-to on the last completed boot, or `null` before the very first boot ever. */
export function getActiveStorageEngine(): StorageEngine | null {
  return readFlag(ACTIVE_ENGINE_KEY);
}

export function setActiveStorageEngine(engine: StorageEngine): void {
  window.localStorage.setItem(ACTIVE_ENGINE_KEY, engine);
}
