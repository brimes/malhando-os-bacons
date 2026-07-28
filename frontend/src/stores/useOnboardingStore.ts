import { create } from 'zustand';
import { apiClient, getErrorMessage } from '../api/client';
import type { OnboardingState, SaveProfileInput, ObjectiveMessageResponse } from '../types';

interface OnboardingStore {
  state: OnboardingState | null;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  fetchState: () => Promise<void>;
  saveProfile: (input: SaveProfileInput) => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  resetObjective: () => Promise<void>;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  state: null,
  isLoading: false,
  isSending: false,
  error: null,

  fetchState: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await apiClient.get<OnboardingState>('/onboarding');
      set({ state: data, isLoading: false });
    } catch (error) {
      set({ error: getErrorMessage(error), isLoading: false });
    }
  },

  saveProfile: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await apiClient.put('/onboarding/profile', input);
      set((current) => ({
        state: current.state ? { ...current.state, profile: data } : null,
        isLoading: false,
      }));
    } catch (error) {
      set({ error: getErrorMessage(error), isLoading: false });
      throw error;
    }
  },

  sendMessage: async (message) => {
    const userMessage = { role: 'user' as const, content: message, created_at: new Date().toISOString() };
    set((current) => ({
      state: current.state ? { ...current.state, messages: [...current.state.messages, userMessage] } : null,
      isSending: true,
      error: null,
    }));
    try {
      const { data } = await apiClient.post<ObjectiveMessageResponse>(
        '/onboarding/objective/messages',
        { message },
        { timeout: 120000 },
      );
      set((current) => ({
        state: current.state ? {
          ...current.state,
          messages: [...current.state.messages, data.message],
          goal: data.goal ?? current.state.goal,
          completed: data.completed,
        } : null,
        isSending: false,
      }));
      if (data.completed) {
        const { data: refreshedState } = await apiClient.get<OnboardingState>('/onboarding');
        set({ state: refreshedState });
      }
    } catch (error) {
      set((current) => ({
        state: current.state ? { ...current.state, messages: current.state.messages.slice(0, -1) } : null,
        error: getErrorMessage(error),
        isSending: false,
      }));
      throw error;
    }
  },

  resetObjective: async () => {
    set({ isLoading: true, error: null });
    try {
      await apiClient.post('/onboarding/objective/reset');
      set((current) => ({
        state: current.state ? { ...current.state, messages: [], goal: undefined, completed: false } : null,
        isLoading: false,
      }));
    } catch (error) {
      set({ error: getErrorMessage(error), isLoading: false });
      throw error;
    }
  },

  reset: () => set({ state: null, isLoading: false, isSending: false, error: null }),
}));
