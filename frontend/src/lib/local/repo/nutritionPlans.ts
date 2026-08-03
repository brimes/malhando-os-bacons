// The `nutrition_plans` collection: read-only from this slice's screens (plan
// *creation*/`NutritionPlan.tsx` is not migrated — see the slice description's
// "caminho incremental"). Only the active plan is read by `Nutrition.tsx`.

import { nutritionApi } from '../../../api/nutrition';
import type { NutritionPlan } from '../../../types';
import { isNetworkOnline } from '../../offline';
import { offlineReady } from '../../offlineBoot';
import { EntityCache } from '../entityStore';
import { hasPendingMutationsFor } from './shared';

const PULL_TIMEOUT_MS = 10_000;
const ROUTE_PREFIX = '/nutrition/plans';

export const nutritionPlansCache = new EntityCache<NutritionPlan>('nutrition_plans');

export function listPlans(): NutritionPlan[] {
  return nutritionPlansCache.getAll();
}

export function getActivePlan(): NutritionPlan | undefined {
  return nutritionPlansCache.getAll().find((plan) => plan.active);
}

// See the matching comment in `repo/foodLogs.ts`: waits for `offlineReady` so
// this never races `useOfflineStore`'s own hydration for the same IndexedDB
// database.
void offlineReady.then(() => nutritionPlansCache.ensureLoaded());

/**
 * Upserts by id — never `clear()` + `putAll` (see the "Ajuste de plano
 * reconcilia no lugar" rule). There is no delete-plan endpoint today, so a
 * stale entry only ever means "not refreshed yet", never "wrongly kept
 * alive". Guarded like every other pull: offline, backgrounded, or anything
 * for `/nutrition/plans` still queued (none of this slice's screens write
 * plans, but `NutritionPlan.tsx`'s create/adjust/activate share the same
 * outbox and would otherwise race a pull that just clobbered their optimistic
 * state — see `Restrições que não podem ser desfeitas`).
 */
export async function pullNutritionPlans(): Promise<void> {
  if (!isNetworkOnline()) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (hasPendingMutationsFor(ROUTE_PREFIX)) return;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timeoutId = controller ? setTimeout(() => controller.abort(), PULL_TIMEOUT_MS) : undefined;
  try {
    const plans = await nutritionApi.listPlans(controller?.signal);
    await nutritionPlansCache.upsertMany(plans);
  } catch {
    // Best-effort: the next scheduled tick retries.
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
