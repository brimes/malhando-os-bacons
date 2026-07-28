import { apiClient } from './client';
import type { AutomaticTrainingPlanInput, TrainingPlan, TrainingPlanInput, TrainingPlanJob } from '../types';

export const trainingPlansApi = {
  list: async () => (await apiClient.get<TrainingPlan[]>('/training-plans')).data,
  get: async (id: number) => (await apiClient.get<TrainingPlan>(`/training-plans/${id}`)).data,
  createManual: async (input: TrainingPlanInput) => (await apiClient.post<TrainingPlan>('/training-plans/manual', input)).data,
  // The assistant takes minutes, so this only enqueues the job — poll getJob until it settles.
  createAutomatic: async (input: AutomaticTrainingPlanInput) => (
    await apiClient.post<TrainingPlanJob>('/training-plans/automatic', input)
  ).data,
  getJob: async (id: number) => (await apiClient.get<TrainingPlanJob>(`/training-plans/jobs/${id}`)).data,
  delete: async (id: number) => {
    await apiClient.delete(`/training-plans/${id}`);
  },
};
