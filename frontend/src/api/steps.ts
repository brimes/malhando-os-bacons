import { apiClient } from './client';
import { todayLocalDate } from '../lib/date';
import type { Steps, SyncStepsInput } from '../types';

export const stepsApi = {
  // Always sent, even for the implicit "today" call: a bare `get:/steps` key
  // would cache under one entry for every day of the app's life and, offline,
  // keep serving whichever day happened to be cached first. See the same fix
  // in useNutritionStore's `logsKey` and Dashboard's `/dashboard` call.
  getToday: async (date: string = todayLocalDate()): Promise<Steps> => {
    const { data } = await apiClient.get<Steps>('/steps', { params: { date } });
    return data;
  },

  sync: async (input: SyncStepsInput): Promise<Steps> => {
    const { data } = await apiClient.post<Steps>('/steps/sync', input);
    return data;
  },
};
