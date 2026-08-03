// Runs once, as a side effect of importing this module (see the bottom of
// `lib/offline.ts`, which every screen reaches transitively through
// `api/client.ts`). Two things have to happen, in this order, before anything
// else touches the offline store:
//
//  1. Reconcile whichever storage engine the flag in `offlineStorageEngine.ts`
//     selects — migrate the old localStorage blob into IndexedDB, or export
//     IndexedDB back into it on a revert.
//  2. Rehydrate `useOfflineStore` from that engine (`skipHydration: true` in
//     `offlineStore.ts` is what keeps zustand from doing this on its own,
//     before step 1 has run).
//
// Only once both are done is `flushQueueIfPending()` safe to call — replaying
// an empty, not-yet-hydrated queue would do nothing, but replaying a *partially*
// hydrated one (had this raced) could drop mutations no one ever saw.
//
// `isHydrated` on the store is what the rest of the app waits on — see
// `App.tsx`'s `ProtectedRoute`. Import order guarantees this module starts
// running before React's first render (ESM evaluates `main.tsx` -> `App.tsx`
// -> the store imports -> here, synchronously, before `ReactDOM.render`), but
// the work itself is asynchronous, hence the flag instead of a blocking await.

import { flushQueueIfPending } from './offlineSync';
import {
  exportIndexedDbToLegacyLocalStorage,
  markPersistHydrated,
  migrateLegacyLocalStorageToIndexedDb,
} from './offlineDbStorage';
import {
  getActiveStorageEngine,
  getStorageEngineFlag,
  setActiveStorageEngine,
} from './offlineStorageEngine';
import { useOfflineStore } from './offlineStore';

/**
 * Migrates or exports only when the desired engine actually changed since the
 * last completed boot — re-running the export on every boot where the flag
 * stayed at `localstorage` would overwrite the fresh data that accumulated
 * there since the last revert with the stale IndexedDB snapshot from the
 * moment of that revert. See `offlineStorageEngine.ts` for what
 * `getActiveStorageEngine` tracks.
 */
async function reconcileStorageEngine(): Promise<void> {
  const desired = getStorageEngineFlag();
  const active = getActiveStorageEngine();
  if (desired === active) return;

  if (desired === 'indexeddb') {
    await migrateLegacyLocalStorageToIndexedDb();
  } else {
    await exportIndexedDbToLegacyLocalStorage();
  }
  setActiveStorageEngine(desired);
}

/**
 * Some WebViews (Safari/WebKit private browsing is the documented case, an old
 * Android WebView with storage disabled is the one seen in practice) never
 * settle an `indexedDB.open()` request at all — no `onsuccess`, no `onerror`.
 * Without a ceiling, that hang would keep `isHydrated` false forever and
 * `ProtectedRoute` would show "Carregando..." forever, which is worse than
 * this slice's whole reason to exist: cold start must not go blank. Five
 * seconds is generous for a real device and short enough that a hung one
 * still gets an app, degraded to whatever was already in memory (usually
 * `initialState` — an empty queue, no active session) instead of stuck.
 */
const HYDRATION_TIMEOUT_MS = 5_000;

async function runBootSequence(): Promise<void> {
  try {
    await reconcileStorageEngine();
  } catch (error) {
    // Whatever engine was already active stays active; better to boot with
    // last session's data than to block forever on a migration that cannot
    // complete (e.g. IndexedDB unavailable in this WebView).
    console.error('[offline] Falha ao reconciliar o motor de armazenamento offline.', error);
  }

  // `rehydrate()` below replaces the *whole* store with whatever it reads
  // from storage (zustand persist's `set(diskState, true)`). The read itself
  // is asynchronous, and — this was the actual bug, reproduced by
  // cold-starting behind a mocked slow network — `useOfflineStore.ts`'s own
  // `setOnline(isNetworkOnline())` call at module load runs synchronously,
  // long before this `await` settles, on the store's still-pristine,
  // not-yet-restored `cache`/`queue`/... . Persist's write subscription fires
  // on *that* `setState` exactly like any other, and unless something stops
  // it, `{ cache: {}, queue: [], ... }` gets written straight over whatever
  // the *previous* session had — silently, permanently, before `rehydrate()`
  // even gets a chance to read the *old* value back. See
  // `markPersistHydrated` (`offlineDbStorage.ts`) — every `setItem` before
  // this call is now a no-op for exactly this reason, closing the window at
  // its actual source rather than papering over the symptom here.
  //
  // The subscription below is what is left once that source is closed: a
  // defense-in-depth for a write this module cannot see coming from a screen
  // that, unlike `TermsGate`/`App.tsx`'s `fetchMe`/`fetchState`, was never
  // audited to wait for `offlineReady` before touching `cache`. Tracking the
  // state as it was *just before* each notification (zustand's subscribe
  // callback gets both) and merging it back after `rehydrate()` resolves
  // means such a write — if one ever slips through — is recovered rather than
  // silently lost, without touching what `rehydrate()` itself restores for
  // every other field (`queue`, `activeSession`, ...).
  let latestCache = useOfflineStore.getState().cache;
  let latestLastSyncAt = useOfflineStore.getState().lastSyncAt;
  const unsubscribe = useOfflineStore.subscribe((_state, previousState) => {
    latestCache = previousState.cache;
    latestLastSyncAt = previousState.lastSyncAt;
  });
  try {
    await useOfflineStore.persist.rehydrate();
  } catch (error) {
    // Same tradeoff as above: an app running on `initialState` (empty queue,
    // no active session) beats one stuck showing the loading screen forever.
    console.error('[offline] Falha ao hidratar o estado offline.', error);
  } finally {
    unsubscribe();
    markPersistHydrated();
  }
  if (Object.keys(latestCache).length > 0 || Object.keys(latestLastSyncAt).length > 0) {
    useOfflineStore.setState((state) => ({
      cache: { ...state.cache, ...latestCache },
      lastSyncAt: { ...state.lastSyncAt, ...latestLastSyncAt },
    }));
  }
}

async function bootOfflineStorage(): Promise<void> {
  const timedOut = await Promise.race([
    runBootSequence().then(() => false),
    new Promise<true>((resolve) => setTimeout(() => resolve(true), HYDRATION_TIMEOUT_MS)),
  ]);
  if (timedOut) {
    console.error('[offline] Hidratação offline não terminou a tempo; liberando a interface do jeito que ela está.');
  }
  useOfflineStore.setState({ isHydrated: true });
  flushQueueIfPending();
}

/**
 * Resolves once migration and hydration have both settled. Most code should
 * read `useOfflineStore((s) => s.isHydrated)` instead (it is reactive); this
 * is for the rare non-React caller — a test, or a boot-time script — that
 * needs to `await` the same thing.
 */
export const offlineReady: Promise<void> = bootOfflineStorage();
