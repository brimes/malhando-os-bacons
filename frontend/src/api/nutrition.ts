import { apiClient } from './client';
import type {
  FoodItem,
  FoodLog,
  NutritionPlan,
  CreateNutritionPlanInput,
  CreateFoodLogInput,
} from '../types';

export const nutritionApi = {
  listPlans: async (): Promise<NutritionPlan[]> => {
    const { data } = await apiClient.get<NutritionPlan[]>('/nutrition/plans');
    return data;
  },

  createPlan: async (input: CreateNutritionPlanInput): Promise<NutritionPlan> => {
    const { data } = await apiClient.post<NutritionPlan>('/nutrition/plans', input);
    return data;
  },

  getLogs: async (date?: string): Promise<FoodLog[]> => {
    const params = date ? { date } : {};
    const { data } = await apiClient.get<FoodLog[]>('/nutrition/logs', { params });
    return data;
  },

  createLog: async (input: CreateFoodLogInput): Promise<FoodLog> => {
    const { data } = await apiClient.post<FoodLog>('/nutrition/logs', input);
    return data;
  },

  searchFoods: async (query: string): Promise<FoodItem[]> => {
    const { data } = await apiClient.get<FoodItem[]>('/nutrition/foods/search', {
      params: { q: query },
    });
    return data;
  },
};
