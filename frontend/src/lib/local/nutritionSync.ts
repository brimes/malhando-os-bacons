// Background sync for nutrition, wired up once as a side effect of importing
// this module (see the bottom of this file, and `offlineBoot.ts` which
// imports it after the entity caches finish loading). Two independent loops:
//
//  - push: the shared mutation queue (`offlineSync.ts`'s `flushQueue`)
//    already knows how to replay and retry — this only decides *when* to
//    call it: right after a local-first write (`repo/shared.ts`'s
//    `enqueueAndPushSoon`, not here), on reconnect, on foreground, and every
//    60s while anything is queued.
//  - pull: one interval per collection, each guarded by the same three
//    rules (offline, backgrounded, outbox non-empty for that collection —
//    see each repo module's pull function) so a screen never has to think
//    about any of this.

import { flushQueueIfPending, onNetworkStatusChange } from '../offline';
import { offlineReady } from '../offlineBoot';
import { pullFoodLogs } from './repo/foodLogs';
import { pullPersonalFoods } from './repo/foodItems';
import { pullNutritionPlans } from './repo/nutritionPlans';

const PUSH_INTERVAL_MS = 60_000;
const FOOD_LOGS_PULL_INTERVAL_MS = 5 * 60_000;
const NUTRITION_PLANS_PULL_INTERVAL_MS = 15 * 60_000;
const FOOD_ITEMS_PULL_INTERVAL_MS = 30 * 60_000;

let started = false;

function schedule(fn: () => void, intervalMs: number): void {
  fn();
  setInterval(fn, intervalMs);
}

/**
 * Starts every timer and listener exactly once. Idempotent so a test (or a
 * hot reload) importing this module more than once cannot double the
 * intervals — nothing here is per-component, it runs for the app's whole
 * lifetime once boot calls this.
 */
export function startNutritionSync(): void {
  if (started) return;
  started = true;

  // Push: reconnect and foreground.
  onNetworkStatusChange((online) => {
    if (online) flushQueueIfPending();
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') flushQueueIfPending();
    });
  }
  setInterval(() => flushQueueIfPending(), PUSH_INTERVAL_MS);

  // Pull: one sliding-window/full-set refetch per collection. Each pull
  // function is its own guard (offline, backgrounded, outbox non-empty) — the
  // rule "nunca rode push ou pull enquanto o probe estiver negativo" is
  // enforced there via `isNetworkOnline()`, not here.
  schedule(() => void pullFoodLogs(), FOOD_LOGS_PULL_INTERVAL_MS);
  schedule(() => void pullNutritionPlans(), NUTRITION_PLANS_PULL_INTERVAL_MS);
  schedule(() => void pullPersonalFoods(), FOOD_ITEMS_PULL_INTERVAL_MS);
}

// Started as a side effect of import — `App.tsx` imports this module for
// exactly that — once `offlineReady` settles, not before: a pull's first
// tick fires immediately (see `schedule`) and writes to the same IndexedDB
// database `useOfflineStore`'s `persist.rehydrate()` is still reading from
// until then. Racing ahead of it risks losing that write the moment
// `rehydrate()` resolves and replaces the store wholesale — see the matching
// comment on `repo/foodLogs.ts`'s own `ensureLoaded()` call.
void offlineReady.then(() => startNutritionSync());
