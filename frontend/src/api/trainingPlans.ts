import { apiClient } from './client';
import { persistPlanDaysDurable } from '../lib/offline';
import type { AutomaticTrainingPlanInput, TrainingPlan, TrainingPlanInput, TrainingPlanJob } from '../types';

export const trainingPlansApi = {
  list: async () => (await apiClient.get<TrainingPlan[]>('/training-plans')).data,
  get: async (id: number) => {
    const plan = (await apiClient.get<TrainingPlan>(`/training-plans/${id}`)).data;
    // Durable, so `findCachedPlanDay` (and therefore starting a session offline)
    // still works after this plan's generic cache entry has been pruned or the
    // quota-recovery path has wiped `cache` outright. See the field comment on
    // `planDays` in `lib/offlineStore.ts`.
    persistPlanDaysDurable(plan);
    return plan;
  },
  createManual: async (input: TrainingPlanInput) => (await apiClient.post<TrainingPlan>('/training-plans/manual', input)).data,
  // The assistant takes minutes, so this only enqueues the job — poll getJob until it settles.
  createAutomatic: async (input: AutomaticTrainingPlanInput) => (
    await apiClient.post<TrainingPlanJob>('/training-plans/automatic', input)
  ).data,
  getJob: async (id: number) => (await apiClient.get<TrainingPlanJob>(`/training-plans/jobs/${id}`)).data,
  // 204 when there is no cheat-day compensation currently valid.
  getCompensation: async (): Promise<TrainingPlan | null> => {
    const { data, status } = await apiClient.get<TrainingPlan | null>('/training-plans/compensation');
    return status === 204 ? null : data;
  },
  // Ajuste por texto livre: também assíncrono, com o mesmo polling de job.
  adjust: async (id: number, instructions: string) => (
    await apiClient.post<TrainingPlanJob>(`/training-plans/${id}/adjust`, { instructions })
  ).data,
  delete: async (id: number) => {
    await apiClient.delete(`/training-plans/${id}`);
  },
};
