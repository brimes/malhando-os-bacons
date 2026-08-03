// The `food_logs` collection: local reads for the diary (`Nutrition.tsx`),
// the calendar (`NutritionHistory.tsx`) and the "+ Log" screen's writes
// (`FoodLog.tsx`), plus the background pull that keeps the last 60 days in
// sync. See the slice description's "Repositório sobre as entidades locais".

import { nutritionApi } from '../../../api/nutrition';
import { todayLocalDate } from '../../date';
import type { CreateFoodLogInput, FoodLog, UpdateFoodLogInput } from '../../../types';
import { dropQueuedMutations, isNetworkOnline, newClientSessionId, takeLocalId } from '../../offline';
import { offlineReady } from '../../offlineBoot';
import { normalizeRoute } from '../../requestPath';
import { queuedMutationsReferencingLocalId, registerLocalIdReconciler, remapQueuedRoute, routeIdPattern } from '../remap';
import { readSyncWindowMeta, writeSyncWindowMeta } from '../syncMeta';
import { EntityCache } from '../entityStore';
import { enqueueAndPushSoon, hasPendingMutationsFor } from './shared';

export const FOOD_LOGS_WINDOW_DAYS = 60;
const PULL_TIMEOUT_MS = 10_000;
const ROUTE_PREFIX = '/nutrition/logs';
const ROUTE_SEGMENT = 'nutrition/logs';
const COLLECTION_NAME = 'food_logs';

export const foodLogsCache = new EntityCache<FoodLog>(COLLECTION_NAME);

/** `FoodLog.date` is RFC3339 from the Go backend (e.g. `2026-08-01T00:00:00Z`) — the calendar day is its first 10 characters. */
export function dateKey(isoDate: string): string {
  return isoDate.slice(0, 10);
}

function isBetween(date: string, from: string, to: string): boolean {
  const key = dateKey(date);
  return key >= from && key <= to;
}

// --- local sync window bookkeeping (isDateSynced) ---------------------------

let syncedWindow: { from: string; to: string } | null = null;

/** Loaded once during boot (see `offlineBoot.ts`) so `isDateSynced` never has to await IndexedDB. */
export async function loadSyncWindow(): Promise<void> {
  const meta = await readSyncWindowMeta(COLLECTION_NAME);
  if (meta?.from && meta.to) syncedWindow = { from: meta.from, to: meta.to };
}

/**
 * True when `date` falls inside a window this device has actually pulled a
 * complete refetch of — the difference between "no logs" and "never asked".
 * A day inside the window with zero records is a real, trustworthy zero; a
 * day outside it is unknown, and the screen should say so instead of showing
 * an empty diary.
 */
export function isDateSynced(date: string): boolean {
  return syncedWindow !== null && date >= syncedWindow.from && date <= syncedWindow.to;
}

/** True when every day of `[from, to]` falls inside the last completed pull's window. */
export function isRangeSynced(from: string, to: string): boolean {
  return syncedWindow !== null && from >= syncedWindow.from && to <= syncedWindow.to;
}

// --- reads --------------------------------------------------------------

export function listByDate(date: string): FoodLog[] {
  return foodLogsCache.getAll().filter((log) => dateKey(log.date) === date);
}

export function listByRange(from: string, to: string): FoodLog[] {
  return foodLogsCache.getAll().filter((log) => isBetween(log.date, from, to));
}

// --- writes: local first, outbox always ----------------------------------

interface LocalCreateInput extends CreateFoodLogInput {
  food_name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/**
 * Writes the log to the local store immediately (negative id) and enqueues
 * the create — with or without a connection, per the slice's "outbox é o
 * caminho único" rule. Callers must already have every macro computed
 * (`FoodLog.tsx` does, for both a catalog pick and a manual entry): the
 * server recomputes calories/macros itself when `food_item_id` is set and
 * ignores whatever is sent for them (see `CreateLog` in
 * `backend/internal/handlers/nutrition.go`), so what is shown here is
 * provisional but never wrong by more than a rounding difference until the
 * create syncs and `put`s the server's authoritative row over it.
 */
export async function createFoodLog(input: LocalCreateInput): Promise<FoodLog> {
  const clientLogId = input.client_log_id ?? newClientSessionId();
  const localId = takeLocalId();
  const now = new Date().toISOString();
  const date = input.date ?? todayLocalDate();
  const optimistic: FoodLog = {
    id: localId,
    user_id: 0,
    food_item_id: input.food_item_id,
    food_name: input.food_name,
    meal_type: input.meal_type,
    quantity_g: input.quantity_g,
    calories: input.calories,
    protein_g: input.protein_g,
    carbs_g: input.carbs_g,
    fat_g: input.fat_g,
    origin: input.origin ?? 'manual',
    client_log_id: clientLogId,
    date: `${date}T00:00:00.000Z`,
    created_at: now,
    updated_at: now,
  };
  await foodLogsCache.put(optimistic);
  enqueueAndPushSoon({
    method: 'POST',
    url: ROUTE_PREFIX,
    body: { ...input, date, client_log_id: clientLogId },
    localEntityId: localId,
  });
  return optimistic;
}

/**
 * Updates the local record immediately. When `id` is still negative (the
 * create has not synced yet) the PUT is queued behind it anyway, addressed at
 * the same negative id — `registerLocalIdReconciler` below rewrites it to the
 * real id the moment the create syncs, same mechanism `remapLocalWorkoutId`
 * uses for a workout's series. FIFO order in the queue is what guarantees the
 * create always replays first.
 */
export async function updateFoodLog(id: number, input: UpdateFoodLogInput): Promise<FoodLog> {
  const current = foodLogsCache.get(id);
  if (!current) throw new Error('Registro não encontrado neste aparelho.');
  const updated: FoodLog = {
    ...current,
    quantity_g: input.quantity_g,
    meal_type: input.meal_type,
    food_name: input.food_name ?? current.food_name,
    calories: input.calories ?? current.calories,
    protein_g: input.protein_g ?? current.protein_g,
    carbs_g: input.carbs_g ?? current.carbs_g,
    fat_g: input.fat_g ?? current.fat_g,
    updated_at: new Date().toISOString(),
  };
  await foodLogsCache.put(updated);
  enqueueAndPushSoon({
    method: 'PUT',
    url: `${ROUTE_PREFIX}/${id}`,
    body: input,
    localEntityId: id < 0 ? id : undefined,
  });
  return updated;
}

/**
 * Removes the local record immediately. A record whose create never synced
 * (`id < 0`) has nothing to tell the server — the queued POST (and anything
 * queued behind it, e.g. an edit made before this delete) is dropped instead
 * of enqueuing a DELETE the server has no id to match.
 */
export async function deleteFoodLog(id: number): Promise<void> {
  await foodLogsCache.remove(id);
  if (id < 0) {
    const pattern = routeIdPattern(ROUTE_SEGMENT, id);
    dropQueuedMutations((mutation) => {
      if (mutation.method === 'POST' && normalizeRoute(mutation.url) === ROUTE_PREFIX && mutation.localEntityId === id) {
        return true;
      }
      return pattern.test(normalizeRoute(mutation.url));
    });
    return;
  }
  enqueueAndPushSoon({ method: 'DELETE', url: `${ROUTE_PREFIX}/${id}` });
}

// --- id reconciliation ----------------------------------------------------

registerLocalIdReconciler({
  matches: (mutation) => mutation.method === 'POST' && normalizeRoute(mutation.url) === ROUTE_PREFIX,
  reconcile: (mutation, response) => {
    const localId = mutation.localEntityId;
    if (typeof localId !== 'number' || localId >= 0) return;
    const created = response as FoodLog | undefined;
    if (!created || typeof created.id !== 'number' || created.id <= 0) return;
    const realId = created.id;
    remapQueuedRoute(ROUTE_SEGMENT, localId, realId);
    // The server's row (authoritative macros for a catalog-linked log, real
    // timestamps) replaces the optimistic one outright, not just its id.
    void foodLogsCache.remove(localId);
    void foodLogsCache.put(created);
  },
  dependents: (mutation, queue) => {
    const localId = mutation.localEntityId;
    if (typeof localId !== 'number' || localId >= 0) return [];
    return queuedMutationsReferencingLocalId(ROUTE_SEGMENT, localId, queue);
  },
});

// --- background pull --------------------------------------------------------

/**
 * Refetches the last `windowDays` as one call and replaces that whole window
 * locally — what makes a server-side delete disappear here too, with no
 * tombstone (see the slice description). Skipped entirely, silently, when:
 * offline (including a negative connectivity probe), the app is backgrounded,
 * or anything for this collection is still queued (the server's copy would be
 * stale — see `hasPendingMutationsFor`).
 */
// Kicked off once `offlineReady` settles — every one of the three migrated
// screens imports this module, so this is effectively "as soon as the app
// boots, right after the offline store's own hydration". Waiting for that
// matters: `useOfflineStore`'s `persist.rehydrate()` (awaited inside
// `offlineReady`) does a wholesale replace of the store when it resolves, and
// starting IndexedDB reads/writes for these collections any earlier races
// them against it — losing that race silently drops whatever `rehydrate()`
// was about to overwrite it with. Importing `offlineBoot.ts` directly (not
// through the `lib/offline.ts` barrel) keeps this a plain one-way dependency:
// `offlineBoot.ts` never imports anything under `lib/local/`.
void offlineReady.then(() => {
  void foodLogsCache.ensureLoaded();
  void loadSyncWindow();
});

export async function pullFoodLogs(windowDays = FOOD_LOGS_WINDOW_DAYS): Promise<void> {
  if (!isNetworkOnline()) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (hasPendingMutationsFor(ROUTE_PREFIX)) return;

  const to = todayLocalDate();
  const from = todayLocalDate(new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timeoutId = controller ? setTimeout(() => controller.abort(), PULL_TIMEOUT_MS) : undefined;
  try {
    const logs = await nutritionApi.getLogsRange(from, to, controller?.signal);
    await foodLogsCache.replaceWindow(logs, (log) => isBetween(log.date, from, to));
    syncedWindow = { from, to };
    await writeSyncWindowMeta(COLLECTION_NAME, { from, to, pulledAt: Date.now() });
  } catch {
    // Best-effort: the next scheduled tick (see `lib/local/nutritionSync.ts`) retries.
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
