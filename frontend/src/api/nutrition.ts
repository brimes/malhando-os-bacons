import { apiClient } from './client';
import type {
  AutomaticNutritionPlanInput,
  CreateFoodItemInput,
  CreateFoodLogInput,
  CreateNutritionPlanInput,
  FoodItem,
  FoodLog,
  LabelAnalysis,
  NutritionCalendarData,
  NutritionPlan,
  NutritionPlanJob,
  NutritionSuggestion,
  PhotoUploadResponse,
  PlateAnalysis,
  UpdateFoodLogInput,
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

  // The assistant takes minutes (targets + full menu), so this only enqueues
  // the job — poll getJob until it settles, same contract as training plans.
  createAutomatic: async (input: AutomaticNutritionPlanInput): Promise<NutritionPlanJob> => {
    const { data } = await apiClient.post<NutritionPlanJob>('/nutrition/plans/automatic', input);
    return data;
  },

  getJob: async (id: number): Promise<NutritionPlanJob> => {
    const { data } = await apiClient.get<NutritionPlanJob>(`/nutrition/plans/jobs/${id}`);
    return data;
  },

  adjust: async (id: number, instructions: string): Promise<NutritionPlanJob> => {
    const { data } = await apiClient.post<NutritionPlanJob>(`/nutrition/plans/${id}/adjust`, { instructions });
    return data;
  },

  activate: async (id: number): Promise<void> => {
    await apiClient.put(`/nutrition/plans/${id}/activate`);
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

  updateLog: async (id: number, input: UpdateFoodLogInput): Promise<FoodLog> => {
    const { data } = await apiClient.put<FoodLog>(`/nutrition/logs/${id}`, input);
    return data;
  },

  deleteLog: async (id: number): Promise<void> => {
    await apiClient.delete(`/nutrition/logs/${id}`);
  },

  searchFoods: async (query: string): Promise<FoodItem[]> => {
    const { data } = await apiClient.get<FoodItem[]>('/nutrition/foods/search', {
      params: { q: query },
    });
    return data;
  },

  listPersonalFoods: async (): Promise<FoodItem[]> => {
    const { data } = await apiClient.get<FoodItem[]>('/nutrition/foods');
    return data;
  },

  createFood: async (input: CreateFoodItemInput): Promise<FoodItem> => {
    const { data } = await apiClient.post<FoodItem>('/nutrition/foods', input);
    return data;
  },

  updateFood: async (id: number, input: CreateFoodItemInput): Promise<FoodItem> => {
    const { data } = await apiClient.put<FoodItem>(`/nutrition/foods/${id}`, input);
    return data;
  },

  deleteFood: async (id: number): Promise<void> => {
    await apiClient.delete(`/nutrition/foods/${id}`);
  },

  calendar: async (month: string): Promise<NutritionCalendarData> => {
    const { data } = await apiClient.get<NutritionCalendarData>('/nutrition/calendar', { params: { month } });
    return data;
  },

  suggestion: async (): Promise<NutritionSuggestion> => {
    const { data } = await apiClient.get<NutritionSuggestion>('/nutrition/suggestion');
    return data;
  },

  // Multipart, never base64-in-JSON: that would inflate the payload by a
  // third and run through the same interceptor that queues offline
  // mutations, which cannot carry a photo. Overriding Content-Type to
  // undefined lets the browser set the multipart boundary itself.
  uploadPlatePhoto: async (file: Blob): Promise<PhotoUploadResponse<PlateAnalysis>> => {
    const form = new FormData();
    form.append('photo', file, 'plate.jpg');
    const { data } = await apiClient.post<PhotoUploadResponse<PlateAnalysis>>('/nutrition/photos?kind=plate', form, {
      headers: { 'Content-Type': undefined },
      timeout: 60000,
    });
    return data;
  },

  uploadLabelPhoto: async (file: Blob): Promise<PhotoUploadResponse<LabelAnalysis>> => {
    const form = new FormData();
    form.append('photo', file, 'label.jpg');
    const { data } = await apiClient.post<PhotoUploadResponse<LabelAnalysis>>('/nutrition/photos?kind=label', form, {
      headers: { 'Content-Type': undefined },
      timeout: 60000,
    });
    return data;
  },

  // Fetches the photo as an authenticated blob (a plain <img src> cannot
  // carry the Authorization header) and hands back an object URL. Callers
  // own revoking it.
  photoObjectUrl: async (id: number): Promise<string> => {
    const { data } = await apiClient.get(`/nutrition/photos/${id}`, { responseType: 'blob' });
    return URL.createObjectURL(data as Blob);
  },
};
