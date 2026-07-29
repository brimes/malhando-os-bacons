import { apiClient } from './client';
import type { TermsStatus } from '../types';

export const termsApi = {
  get: async (): Promise<TermsStatus> => (await apiClient.get<TermsStatus>('/terms')).data,
  accept: async (version: string): Promise<void> => {
    await apiClient.post('/terms/accept', { version });
  },
};
