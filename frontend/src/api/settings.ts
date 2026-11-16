import { apiClient } from './client';
import { enqueueWrite, resourceKeyForRequest } from '../lib/offline';
import type { TrainingSettings } from '../types';

export const DEFAULT_SETTINGS: TrainingSettings = {
  countdown_seconds: 5,
  vibration_enabled: true,
  auto_advance: false,
};

export const settingsApi = {
  get: async (): Promise<TrainingSettings> => (await apiClient.get<TrainingSettings>('/settings')).data,
  /** Estado atual, não evento: a última gravação na fila vence (dedupeKey) e reenviar converge. */
  update: (input: TrainingSettings): TrainingSettings => {
    enqueueWrite({
      method: 'PUT',
      url: '/settings',
      body: input,
      dedupeKey: 'settings',
      idempotent: true,
      optimistic: [{ key: resourceKeyForRequest('/settings'), apply: () => input }],
    });
    return input;
  },
};
