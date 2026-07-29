import { create } from 'zustand';
import { apiClient, getErrorMessage } from '../api/client';
import { hasCache, patchCacheLocally, readThrough, resourceKeyForRequest } from '../lib/offline';
import type { OnboardingState, SaveProfileInput, ObjectiveMessageResponse } from '../types';

const ONBOARDING_KEY = resourceKeyForRequest('/onboarding');

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

  // App.tsx holds every protected route until this resolves, so it reads the
  // local copy first: a cold start with no connection lands on the app instead
  // of hanging on "Carregando...".
  fetchState: async () => {
    set({ isLoading: !hasCache(ONBOARDING_KEY), error: null });
    await readThrough<OnboardingState>({
      resourceKey: ONBOARDING_KEY,
      fetcher: async () => (await apiClient.get<OnboardingState>('/onboarding')).data,
      apply: (data) => set({ state: data, isLoading: false }),
      // A failed revalidation is silent while there is a local copy on screen.
      onError: (error, hadCache) => set({ isLoading: false, error: hadCache ? null : getErrorMessage(error) }),
    });
  },

  saveProfile: async (input) => {
    set({ isLoading: true, error: null });
    try {
      // Offline the PUT is queued and echoed back, so the profile on screen is
      // the one that was just typed either way.
      const { data } = await apiClient.put('/onboarding/profile', input);
      set((current) => {
        const state = current.state ? { ...current.state, profile: data } : null;
        if (state) patchCacheLocally(ONBOARDING_KEY, state);
        return { state, isLoading: false };
      });
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
