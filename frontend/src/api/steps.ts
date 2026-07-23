import { apiClient } from './client';
import type { Steps, SyncStepsInput } from '../types';

export const stepsApi = {
  getToday: async (date?: string): Promise<Steps> => {
    const params = date ? { date } : {};
    const { data } = await apiClient.get<Steps>('/steps', { params });
    return data;
  },

  sync: async (input: SyncStepsInput): Promise<Steps> => {
    const { data } = await apiClient.post<Steps>('/steps/sync', input);
    return data;
  },
};
