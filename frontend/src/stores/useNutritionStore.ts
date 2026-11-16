import { create } from 'zustand';
import { nutritionApi } from '../api/nutrition';
import { getErrorMessage } from '../api/client';
import { dropQueuedMutations, enqueueWrite, hasCache, isNetworkOnline, newClientSessionId, patchCacheLocally, readCache, readThrough, resourceKeyForRequest } from '../lib/offline';
import { normalizeRoute } from '../lib/requestPath';
import { hasPendingMutationsFor } from '../lib/local/repo/shared';
import { nutritionPlansCache } from '../lib/local/repo/nutritionPlans';
import { queuedMutationsReferencingLocalId, registerLocalIdReconciler, remapQueuedRoute, routeIdPattern } from '../lib/local/remap';
import type {
  CreateFoodItemInput,
  CreateFoodLogInput,
  CreateNutritionPlanInput,
  FoodItem,
  FoodLog,
  FoodLogHistoryEntry,
  MissingDaysResponse,
  NutritionPlan,
  NutritionRoutine,
  UpdateFoodLogInput,
} from '../types';

interface NutritionState {
  plans: NutritionPlan[];
  activePlan: NutritionPlan | null;
  todayLogs: FoodLog[];
  personalFoods: FoodItem[];
  searchResults: FoodItem[];
  isLoading: boolean;
  isSearching: boolean;
  error: string | null;
  logHistory: FoodLogHistoryEntry[];
  isLoadingHistory: boolean;
  /** Resultado da busca no histórico — separado de `logHistory`, que é a lista padrão. */
  historyResults: FoodLogHistoryEntry[];
  /** "Dia normal" destilado do histórico — ver GET /api/nutrition/routine. Null até o primeiro fetch. */
  routine: NutritionRoutine | null;
  isLoadingRoutine: boolean;
  /** Datas dos últimos 30 dias sem nenhum food_log — ver GET /api/nutrition/missing-days. */
  missingDays: string[];
  isLoadingMissingDays: boolean;

  fetchPlans: () => Promise<void>;
  createPlan: (input: CreateNutritionPlanInput) => Promise<void>;
  /** Ativa um plano: grava no aparelho e envia em segundo plano. */
  activatePlan: (id: number) => Promise<void>;
  fetchTodayLogs: (date?: string) => Promise<void>;
  logFood: (input: CreateFoodLogInput) => Promise<FoodLog>;
  updateLog: (id: number, input: UpdateFoodLogInput, date?: string) => Promise<void>;
  deleteLog: (id: number, date?: string) => Promise<void>;
  searchFoods: (query: string) => Promise<void>;
  /**
   * Busca no histórico da pessoa, no servidor. A tela filtrava localmente a
   * lista já cortada em 50, então comida registrada há tempo era inalcançável
   * — nem pela lista, nem por `searchFoods`, que só enxerga o catálogo.
   */
  searchHistory: (query: string) => Promise<void>;
  clearSearch: () => void;
  fetchPersonalFoods: () => Promise<void>;
  createFood: (input: CreateFoodItemInput) => Promise<FoodItem>;
  deleteFood: (id: number) => Promise<void>;
  clearError: () => void;
  fetchLogHistory: () => Promise<void>;
  /**
   * Favorites/unfavorites `entry`, updating `logHistory` in place — no
   * refetch, so the "+ Log" screen sees the star move immediately. Throws on
   * failure (offline unfavoriting something favorited offline included, see
   * `referencesLocalId`), left for the screen to catch and show.
   */
  toggleFavorite: (entry: FoodLogHistoryEntry) => Promise<void>;
  fetchRoutine: () => Promise<void>;
  fetchMissingDays: () => Promise<void>;
  /** Drops `date` from `missingDays` right after it is confirmed or dismissed, without a refetch. */
  removeMissingDay: (date: string) => void;
}

const plansKey = () => resourceKeyForRequest('/nutrition/plans');
// The logs endpoint is per day, so each day gets its own snapshot.
const logsKey = (date?: string) => resourceKeyForRequest('/nutrition/logs', date ? { date } : undefined);
const personalFoodsKey = () => resourceKeyForRequest('/nutrition/foods');
const logHistoryKey = () => resourceKeyForRequest('/nutrition/logs/history');
const routineKey = () => resourceKeyForRequest('/nutrition/routine');
const missingDaysKey = () => resourceKeyForRequest('/nutrition/missing-days');

export const useNutritionStore = create<NutritionState>((set, get) => ({
  plans: [],
  activePlan: null,
  todayLogs: [],
  personalFoods: [],
  searchResults: [],
  isLoading: false,
  isSearching: false,
  error: null,
  logHistory: [],
  isLoadingHistory: false,
  historyResults: [],
  routine: null,
  isLoadingRoutine: false,
  missingDays: [],
  isLoadingMissingDays: false,

  fetchPlans: async () => {
    set({ isLoading: !hasCache(plansKey()), error: null });
    // Plano criado/ativado e ainda na fila: a lista do servidor está atrás.
    const local = readCache<NutritionPlan[]>(plansKey());
    if (local && hasPendingMutationsFor('/nutrition/plans')) {
      set({ plans: local, activePlan: local.find((plan) => plan.active) ?? null, isLoading: false });
      return;
    }
    await readThrough<NutritionPlan[]>({
      resourceKey: plansKey(),
      fetcher: () => nutritionApi.listPlans(),
      apply: (plans) => set({
        plans,
        activePlan: plans.find((plan) => plan.active) ?? null,
        isLoading: false,
      }),
      onError: (error, hadCache) => set({ isLoading: false, error: hadCache ? null : getErrorMessage(error) }),
    });
  },

  createPlan: async (input: CreateNutritionPlanInput) => {
    const base: NutritionPlan = {
      id: 0,
      user_id: 0,
      name: input.name,
      calories_target: input.calories_target,
      protein_target: input.protein_target,
      carbs_target: input.carbs_target,
      fat_target: input.fat_target,
      creation_method: 'manual',
      active: true,
      created_at: new Date().toISOString(),
      meals: [],
    };
    const { entityId } = enqueueWrite({
      method: 'POST',
      url: '/nutrition/plans',
      body: { ...input, client_id: newClientSessionId() },
      idempotent: true,
      createsEntity: true,
    });
    const plan = { ...base, id: entityId as number };
    const known = get().plans.length ? get().plans : readCache<NutritionPlan[]>(plansKey()) ?? [];
    const plans = [plan, ...known.map((current) => ({ ...current, active: false }))];
    set({ plans, activePlan: plan, isLoading: false, error: null });
    patchCacheLocally(plansKey(), plans);
    for (const item of plans) void nutritionPlansCache.put(item);
  },

  activatePlan: async (id: number) => {
    const plans = get().plans.map((plan) => ({ ...plan, active: plan.id === id }));
    enqueueWrite({ method: 'PUT', url: `/nutrition/plans/${id}/activate`, idempotent: true });
    set({ plans, activePlan: plans.find((plan) => plan.active) ?? null });
    patchCacheLocally(plansKey(), plans);
    for (const item of plans) void nutritionPlansCache.put(item);
  },

  fetchTodayLogs: async (date?: string) => {
    set({ isLoading: !hasCache(logsKey(date)), error: null });
    await readThrough<FoodLog[]>({
      resourceKey: logsKey(date),
      fetcher: () => nutritionApi.getLogs(date),
      apply: (todayLogs) => set({ todayLogs, isLoading: false }),
      onError: (error, hadCache) => set({ isLoading: false, error: hadCache ? null : getErrorMessage(error) }),
    });
  },

  logFood: async (input: CreateFoodLogInput) => {
    set({ isLoading: true, error: null });
    try {
      // Minted here, not by the caller: this is the id that lets a replay of
      // the queued write be recognised as the same log instead of a
      // duplicate, the same role client_set_id plays for workout sets.
      const body: CreateFoodLogInput = { ...input, client_log_id: input.client_log_id ?? newClientSessionId() };
      const log = await nutritionApi.createLog(body);
      const todayLogs = [...get().todayLogs, log];
      set({ todayLogs, isLoading: false });
      // The log belongs to the day it was recorded on, which is the day the
      // screen is showing — keeping the two in step offline as well.
      patchCacheLocally(logsKey(input.date), todayLogs);
      return log;
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  updateLog: async (id: number, input: UpdateFoodLogInput, date?: string) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await nutritionApi.updateLog(id, input);
      // Merged, not replaced: a queued PUT resolves through the offline
      // interceptor with an optimistic payload that echoes exactly the
      // fields sent in the request, plus `id`/`offline_pending` — see
      // buildOptimisticPayload in api/client.ts. EditFoodLogModal always
      // sends food_name and every macro explicitly, so that echo already
      // has real values and a plain merge is correct. Only a caller that
      // sends quantity_g/meal_type alone (the old behavior; nothing does
      // today) gets the ratio rescale below, mirroring what the server does
      // for that same case in backend/internal/handlers/nutrition.go —
      // without it, the rings would show the new quantity next to macros
      // still scaled for the old one until the next successful fetch.
      const pending = updated as FoodLog & { offline_pending?: boolean };
      const todayLogs = get().todayLogs.map((log) => {
        if (log.id !== id) return log;
        if (pending.offline_pending && input.calories === undefined && log.quantity_g > 0) {
          const ratio = pending.quantity_g / log.quantity_g;
          return {
            ...log,
            ...updated,
            calories: log.calories * ratio,
            protein_g: log.protein_g * ratio,
            carbs_g: log.carbs_g * ratio,
            fat_g: log.fat_g * ratio,
          };
        }
        return { ...log, ...updated };
      });
      set({ todayLogs, isLoading: false });
      patchCacheLocally(logsKey(date), todayLogs);
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  deleteLog: async (id: number, date?: string) => {
    set({ isLoading: true, error: null });
    try {
      await nutritionApi.deleteLog(id);
      const todayLogs = get().todayLogs.filter((log) => log.id !== id);
      set({ todayLogs, isLoading: false });
      patchCacheLocally(logsKey(date), todayLogs);
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  searchFoods: async (query: string) => {
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    // Searching the shared catalog is a server query over data the device
    // never holds; there is nothing sensible to serve from the cache. This
    // still means offline food search is unavailable — personal foods (the
    // ones that matter day to day) are covered separately by fetchPersonalFoods.
    if (!isNetworkOnline()) {
      set({ searchResults: [], isSearching: false, error: 'A busca de alimentos precisa de internet.' });
      return;
    }
    set({ isSearching: true });
    try {
      const results = await nutritionApi.searchFoods(query);
      set({ searchResults: results, isSearching: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isSearching: false });
    }
  },

  searchHistory: async (query: string) => {
    const termo = query.trim();
    if (!termo) {
      set({ historyResults: [] });
      return;
    }
    if (!isNetworkOnline()) {
      // Offline a lista padrão em cache ainda serve, e a tela cai no filtro
      // local sobre ela — pior que a busca do servidor, melhor que um erro.
      set({ historyResults: [] });
      return;
    }
    try {
      set({ historyResults: await nutritionApi.getLogHistory(termo) });
    } catch {
      set({ historyResults: [] });
    }
  },

  clearSearch: () => set({ searchResults: [], historyResults: [] }),

  fetchPersonalFoods: async () => {
    set({ isLoading: !hasCache(personalFoodsKey()), error: null });
    await readThrough<FoodItem[]>({
      resourceKey: personalFoodsKey(),
      fetcher: () => nutritionApi.listPersonalFoods(),
      apply: (personalFoods) => set({ personalFoods, isLoading: false }),
      onError: (error, hadCache) => set({ isLoading: false, error: hadCache ? null : getErrorMessage(error) }),
    });
  },

  createFood: async (input: CreateFoodItemInput) => {
    set({ isLoading: true, error: null });
    try {
      const food = await nutritionApi.createFood(input);
      const personalFoods = [...get().personalFoods, food].sort((a, b) => a.name.localeCompare(b.name));
      set({ personalFoods, isLoading: false });
      patchCacheLocally(personalFoodsKey(), personalFoods);
      return food;
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  deleteFood: async (id: number) => {
    set({ isLoading: true, error: null });
    try {
      await nutritionApi.deleteFood(id);
      const personalFoods = get().personalFoods.filter((food) => food.id !== id);
      set({ personalFoods, isLoading: false });
      patchCacheLocally(personalFoodsKey(), personalFoods);
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  clearError: () => set({ error: null }),

  fetchLogHistory: async () => {
    set({ isLoadingHistory: !hasCache(logHistoryKey()), error: null });
    await readThrough<FoodLogHistoryEntry[]>({
      resourceKey: logHistoryKey(),
      fetcher: () => nutritionApi.getLogHistory(),
      apply: (logHistory) => set({ logHistory, isLoadingHistory: false }),
      onError: (error, hadCache) => set({ isLoadingHistory: false, error: hadCache ? null : getErrorMessage(error) }),
    });
  },

  // Favoritar nunca espera a rede: grava no aparelho (estrela muda na hora) e
  // envia em segundo plano. Um favorito criado offline tem id negativo até o
  // envio; desfavoritar antes disso apenas retira o envio da fila.
  toggleFavorite: async (entry: FoodLogHistoryEntry) => {
    const apply = (favoriteId: number | undefined) => {
      const logHistory = get()
        .logHistory
        // Linha que só existia por estar favoritada some ao desfavoritar.
        .filter((item) => item.group_key !== entry.group_key || favoriteId !== undefined || item.times_logged > 0)
        .map((item) => (item.group_key === entry.group_key ? { ...item, favorite_id: favoriteId } : item));
      set({ logHistory });
      patchCacheLocally(logHistoryKey(), logHistory);
    };
    if (entry.favorite_id) {
      const id = entry.favorite_id;
      if (id < 0) {
        const pattern = routeIdPattern('nutrition/favorites', id);
        dropQueuedMutations((m) => (
          (m.method === 'POST' && normalizeRoute(m.url) === '/nutrition/favorites' && m.localEntityId === id) || pattern.test(normalizeRoute(m.url))
        ));
      } else {
        enqueueWrite({ method: 'DELETE', url: `/nutrition/favorites/${id}`, idempotent: true });
      }
      apply(undefined);
      return;
    }
    const { entityId } = enqueueWrite({
      method: 'POST',
      url: '/nutrition/favorites',
      body: {
        group_key: entry.group_key,
        food_item_id: entry.food_item_id,
        food_name: entry.food_name,
        quantity_g: entry.quantity_g,
        meal_type: entry.meal_type,
        calories: entry.calories,
        protein_g: entry.protein_g,
        carbs_g: entry.carbs_g,
        fat_g: entry.fat_g,
      },
      // O servidor grava por group_key: reenviar converge para o mesmo favorito.
      idempotent: true,
      createsEntity: true,
    });
    apply(entityId);
  },

  fetchRoutine: async () => {
    set({ isLoadingRoutine: !hasCache(routineKey()) });
    await readThrough<NutritionRoutine>({
      resourceKey: routineKey(),
      fetcher: () => nutritionApi.getRoutine(),
      apply: (routine) => set({ routine, isLoadingRoutine: false }),
      onError: (_error, hadCache) => set({ isLoadingRoutine: false, routine: hadCache ? get().routine : null }),
    });
  },

  fetchMissingDays: async () => {
    set({ isLoadingMissingDays: !hasCache(missingDaysKey()) });
    await readThrough<MissingDaysResponse>({
      resourceKey: missingDaysKey(),
      fetcher: () => nutritionApi.getMissingDays(),
      apply: (response) => set({ missingDays: response.days, isLoadingMissingDays: false }),
      onError: (_error, hadCache) => set({ isLoadingMissingDays: false, missingDays: hadCache ? get().missingDays : [] }),
    });
  },

  removeMissingDay: (date: string) => {
    const missingDays = get().missingDays.filter((d) => d !== date);
    set({ missingDays });
    patchCacheLocally(missingDaysKey(), { days: missingDays });
  },
}));

// Quando o POST do favorito chega, o id real substitui o local: nos envios
// ainda na fila (um DELETE feito depois) e na lista que a tela está mostrando.
registerLocalIdReconciler({
  matches: (mutation) => mutation.method === 'POST' && normalizeRoute(mutation.url) === '/nutrition/favorites',
  reconcile: (mutation, response) => {
    const localId = mutation.localEntityId;
    const created = response as { id?: number } | undefined;
    if (typeof localId !== 'number' || localId >= 0 || typeof created?.id !== 'number' || created.id <= 0) return;
    const realId = created.id;
    remapQueuedRoute('nutrition/favorites', localId, realId);
    const swap = (list: FoodLogHistoryEntry[]) => list.map((item) => (item.favorite_id === localId ? { ...item, favorite_id: realId } : item));
    useNutritionStore.setState((state) => ({ logHistory: swap(state.logHistory) }));
    const cached = readCache<FoodLogHistoryEntry[]>(logHistoryKey());
    if (cached) patchCacheLocally(logHistoryKey(), swap(cached));
  },
  dependents: (mutation, queue) => {
    const localId = mutation.localEntityId;
    if (typeof localId !== 'number' || localId >= 0) return [];
    return queuedMutationsReferencingLocalId('nutrition/favorites', localId, queue);
  },
});

// Plano manual criado offline: o id real troca o local nos envios pendentes
// (ex.: ativar) e a cópia do servidor substitui a otimista.
registerLocalIdReconciler({
  matches: (mutation) => mutation.method === 'POST' && normalizeRoute(mutation.url) === '/nutrition/plans',
  reconcile: (mutation, response) => {
    const localId = mutation.localEntityId;
    const created = response as NutritionPlan | undefined;
    if (typeof localId !== 'number' || localId >= 0 || typeof created?.id !== 'number' || created.id <= 0) return;
    remapQueuedRoute('nutrition/plans', localId, created.id);
    const swap = (list: NutritionPlan[]) => list.map((item) => (item.id === localId ? { ...created, active: item.active } : item));
    useNutritionStore.setState((state) => {
      const plans = swap(state.plans);
      return { plans, activePlan: plans.find((plan) => plan.active) ?? null };
    });
    const cached = readCache<NutritionPlan[]>(plansKey());
    if (cached) patchCacheLocally(plansKey(), swap(cached));
    void nutritionPlansCache.remove(localId);
    void nutritionPlansCache.put(created);
  },
  dependents: (mutation, queue) => {
    const localId = mutation.localEntityId;
    if (typeof localId !== 'number' || localId >= 0) return [];
    return queuedMutationsReferencingLocalId('nutrition/plans', localId, queue);
  },
});
