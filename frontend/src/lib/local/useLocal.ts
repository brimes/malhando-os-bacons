// The read side of local-first: a screen calls this instead of
// `useEffect(() => fetchX())` + `isLoading` state. See the slice description's
// "Leitura: local primeiro, revalida em segundo plano" — the contract is:
//  - the data from IndexedDB, synchronously, on the very first render
//    (`EntityCache.ensureLoaded()` already ran during boot — see
//    `offlineBoot.ts` — so there is no async gap to cover here);
//  - never `undefined` once hydrated — `[]` or the value;
//  - a re-render whenever the pull or the outbox change the collection
//    (`EntityCache.subscribe`, which every write and every pull goes through).
//
// Background revalidation itself (the pull) is not triggered from here — see
// `lib/local/nutritionSync.ts`'s timers/listeners — this hook only *reads*
// and *reacts*, it does not schedule network work on render.
//
// Deliberately hands back the whole collection, unfiltered: a screen that
// only wants today's logs (or one month's range) derives that with its own
// `useMemo(() => all.filter(...), [all, date])`. Filtering in here too would
// mean memoizing against an externally-supplied `select` callback, whose
// identity changes with whatever it closes over (`date`, e.g.) on every
// render — `useSyncExternalStore` requires `getSnapshot` to return the same
// reference when nothing changed, and a `select` that goes stale between
// renders is exactly the kind of bug that contract makes easy to introduce by
// accident.

import { useCallback, useSyncExternalStore } from 'react';
import type { EntityCache } from './entityStore';

/** The raw contents of `cache`, kept as one stable array reference per revision. */
export function useLocalAll<T extends { id: number }>(cache: EntityCache<T>): T[] {
  const subscribe = useCallback((onStoreChange: () => void) => cache.subscribe(onStoreChange), [cache]);
  const getSnapshot = useCallback(() => cache.getSnapshot(), [cache]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
