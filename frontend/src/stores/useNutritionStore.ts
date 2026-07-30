import { create } from 'zustand';
import { nutritionApi } from '../api/nutrition';
import { getErrorMessage } from '../api/client';
import { hasCache, isNetworkOnline, newClientSessionId, patchCacheLocally, readThrough, resourceKeyForRequest } from '../lib/offline';
import type {
  CreateFoodItemInput,
  CreateFoodLogInput,
  CreateNutritionPlanInput,
  FoodItem,
  FoodLog,
  NutritionPlan,
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

  fetchPlans: () => Promise<void>;
  createPlan: (input: CreateNutritionPlanInput) => Promise<void>;
  fetchTodayLogs: (date?: string) => Promise<void>;
  logFood: (input: CreateFoodLogInput) => Promise<FoodLog>;
  updateLog: (id: number, input: UpdateFoodLogInput, date?: string) => Promise<void>;
  deleteLog: (id: number, date?: string) => Promise<void>;
  searchFoods: (query: string) => Promise<void>;
  clearSearch: () => void;
  fetchPersonalFoods: () => Promise<void>;
  createFood: (input: CreateFoodItemInput) => Promise<FoodItem>;
  deleteFood: (id: number) => Promise<void>;
  clearError: () => void;
}

const plansKey = () => resourceKeyForRequest('/nutrition/plans');
// The logs endpoint is per day, so each day gets its own snapshot.
const logsKey = (date?: string) => resourceKeyForRequest('/nutrition/logs', date ? { date } : undefined);
const personalFoodsKey = () => resourceKeyForRequest('/nutrition/foods');

export const useNutritionStore = create<NutritionState>((set, get) => ({
  plans: [],
  activePlan: null,
  todayLogs: [],
  personalFoods: [],
  searchResults: [],
  isLoading: false,
  isSearching: false,
  error: null,

  fetchPlans: async () => {
    set({ isLoading: !hasCache(plansKey()), error: null });
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
    set({ isLoading: true, error: null });
    try {
      const plan = await nutritionApi.createPlan(input);
      const plans = [plan, ...get().plans.map((current) => ({ ...current, active: false }))];
      set({ plans, activePlan: plan, isLoading: false });
      patchCacheLocally(plansKey(), plans);
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
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
      const todayLogs = get().todayLogs.map((log) => (log.id === id ? updated : log));
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

  clearSearch: () => set({ searchResults: [] }),

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
}));
