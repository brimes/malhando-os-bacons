import { create } from 'zustand';
import { nutritionApi } from '../api/nutrition';
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

export const useNutritionStore = create<NutritionState>((set, get) => ({
  plans: [],
  activePlan: null,
  todayLogs: [],
  searchResults: [],
  isLoading: false,
  isSearching: false,
  error: null,

  fetchPlans: async () => {
    set({ isLoading: true, error: null });
    try {
      const plans = await nutritionApi.listPlans();
      const active = plans.find((p) => p.active) ?? null;
      set({ plans, activePlan: active, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  createPlan: async (input: CreateNutritionPlanInput) => {
    set({ isLoading: true, error: null });
    try {
      const plan = await nutritionApi.createPlan(input);
      set((state) => ({
        plans: [plan, ...state.plans.map((p) => ({ ...p, active: false }))],
        activePlan: plan,
        isLoading: false,
      }));
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  fetchTodayLogs: async (date?: string) => {
    set({ isLoading: true, error: null });
    try {
      const logs = await nutritionApi.getLogs(date);
      set({ todayLogs: logs, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  logFood: async (input: CreateFoodLogInput) => {
    set({ isLoading: true, error: null });
    try {
      const log = await nutritionApi.createLog(input);
      set((state) => ({
        todayLogs: [...state.todayLogs, log],
        isLoading: false,
      }));
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  searchFoods: async (query: string) => {
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    set({ isSearching: true });
    try {
      const results = await nutritionApi.searchFoods(query);
      set({ searchResults: results, isSearching: false });
    } catch (err) {
      set({ error: String(err), isSearching: false });
    }
  },

  clearSearch: () => set({ searchResults: [] }),
  clearError: () => set({ error: null }),
}));
