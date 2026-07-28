import { apiClient } from './client';
import type { TrainingSettings } from '../types';

export const DEFAULT_SETTINGS: TrainingSettings = {
  countdown_seconds: 5,
  vibration_enabled: true,
  auto_advance: false,
};

export const settingsApi = {
  get: async (): Promise<TrainingSettings> => (await apiClient.get<TrainingSettings>('/settings')).data,
  update: async (input: TrainingSettings): Promise<TrainingSettings> => (
    await apiClient.put<TrainingSettings>('/settings', input)
  ).data,
};
