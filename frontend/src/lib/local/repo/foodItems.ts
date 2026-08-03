// The `food_items` collection: this device's personal foods (the shared
// catalog is never stored locally — search stays online-only by design, see
// the slice description). Not consumed by any of the three migrated screens
// today (`FoodLog.tsx`'s catalog search is live, and `logHistory` — the "já
// registrei" list — stays on the existing `readThrough` cache, out of scope
// for this slice); kept anyway per the spec's module list, ready for the
// screen that manages personal foods (`NutritionPlan.tsx`) to move onto it
// later without a new collection to design.

import { nutritionApi } from '../../../api/nutrition';
import type { FoodItem } from '../../../types';
import { isNetworkOnline } from '../../offline';
import { offlineReady } from '../../offlineBoot';
import { EntityCache } from '../entityStore';
import { hasPendingMutationsFor } from './shared';

const PULL_TIMEOUT_MS = 10_000;
const ROUTE_PREFIX = '/nutrition/foods';

export const foodItemsCache = new EntityCache<FoodItem>('food_items');

export function listPersonalFoods(): FoodItem[] {
  return foodItemsCache.getAll();
}

// See the matching comment in `repo/foodLogs.ts`: waits for `offlineReady` so
// this never races `useOfflineStore`'s own hydration for the same IndexedDB
// database.
void offlineReady.then(() => foodItemsCache.ensureLoaded());

/**
 * Whole-collection replace: unlike the plans pull, a personal food really can
 * be deleted server-side (`DeleteFood`), and this pull always fetches the
 * complete set (no window), so a record missing from the response means
 * exactly that — safe to drop locally too, same reasoning `replaceAll`'s own
 * comment gives.
 */
export async function pullPersonalFoods(): Promise<void> {
  if (!isNetworkOnline()) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (hasPendingMutationsFor(ROUTE_PREFIX)) return;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timeoutId = controller ? setTimeout(() => controller.abort(), PULL_TIMEOUT_MS) : undefined;
  try {
    const foods = await nutritionApi.listPersonalFoods(controller?.signal);
    await foodItemsCache.replaceAll(foods);
  } catch {
    // Best-effort: the next scheduled tick retries.
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
