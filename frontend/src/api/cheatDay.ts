import { apiClient } from './client';
import type { CheatDaySession } from '../types';

export const cheatDayApi = {
  // 204 (no open session) resolves with undefined data, not an error.
  get: async (): Promise<CheatDaySession | null> => {
    const { data, status } = await apiClient.get<CheatDaySession | null>('/nutrition/cheat-day');
    return status === 204 ? null : data;
  },

  sendMessage: async (content: string): Promise<CheatDaySession> => {
    const { data } = await apiClient.post<CheatDaySession>('/nutrition/cheat-day/messages', { content });
    return data;
  },

  accept: async (sessionId: number): Promise<CheatDaySession> => {
    const { data } = await apiClient.post<CheatDaySession>(`/nutrition/cheat-day/${sessionId}/accept`);
    return data;
  },

  discard: async (sessionId: number): Promise<void> => {
    await apiClient.post(`/nutrition/cheat-day/${sessionId}/discard`);
  },
};
