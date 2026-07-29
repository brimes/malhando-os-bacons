import { create } from 'zustand';
import { nutritionApi } from '../api/nutrition';
import { getErrorMessage } from '../api/client';
import { hasCache, isNetworkOnline, patchCacheLocally, readThrough, resourceKeyForRequest } from '../lib/offline';
import type { FoodItem, FoodLog, NutritionPlan, CreateNutritionPlanInput, CreateFoodLogInput } from '../types';

interface NutritionState {
  plans: NutritionPlan[];
  activePlan: NutritionPlan | null;
  todayLogs: FoodLog[];
  searchResults: FoodItem[];
  isLoading: boolean;
  isSearching: boolean;
  error: string | null;

  fetchPlans: () => Promise<void>;
  createPlan: (input: CreateNutritionPlanInput) => Promise<void>;
  fetchTodayLogs: (date?: string) => Promise<void>;
  logFood: (input: CreateFoodLogInput) => Promise<void>;
  searchFoods: (query: string) => Promise<void>;
  clearSearch: () => void;
  clearError: () => void;
}

const plansKey = () => resourceKeyForRequest('/nutrition/plans');
// The logs endpoint is per day, so each day gets its own snapshot.
const logsKey = (date?: string) => resourceKeyForRequest('/nutrition/logs', date ? { date } : undefined);

export const useNutritionStore = create<NutritionState>((set, get) => ({
  plans: [],
  activePlan: null,
  todayLogs: [],
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
      const log = await nutritionApi.createLog(input);
      const todayLogs = [...get().todayLogs, log];
      set({ todayLogs, isLoading: false });
      // The log belongs to the day it was recorded on, which is the day the
      // screen is showing — keeping the two in step offline as well.
      patchCacheLocally(logsKey(input.date), todayLogs);
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
    // Searching the food table is a server query over data the device never
    // holds; there is nothing sensible to serve from the cache.
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
  clearError: () => set({ error: null }),
}));
