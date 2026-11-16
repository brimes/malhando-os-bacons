import { create } from 'zustand';
import { apiClient, getErrorMessage } from '../api/client';
import { enqueueWrite, hasCache, readCache, readThrough, resourceKeyForRequest } from '../lib/offline';
import { hasPendingMutationsFor } from '../lib/local/repo/shared';
import type { OnboardingState, SaveProfileInput, ObjectiveMessageResponse, UserProfile } from '../types';

const ONBOARDING_KEY = resourceKeyForRequest('/onboarding');

function ageFrom(birthDate: string): number | undefined {
  const born = new Date(`${birthDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(born.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) age -= 1;
  return age;
}

/** O que o servidor devolveria: o corpo enviado sobre o perfil atual, com a idade recalculada. */
function mergeProfile(current: UserProfile | undefined, input: SaveProfileInput): UserProfile {
  return { ...current, ...input, age: ageFrom(input.birth_date) ?? current?.age } as UserProfile;
}

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
    // Perfil salvo e ainda na fila: a cópia do servidor está atrás e pisaria
    // no que a pessoa acabou de gravar. Fica só a cópia local até a fila esvaziar.
    if (hasCache(ONBOARDING_KEY) && hasPendingMutationsFor('/onboarding')) {
      set({ state: readCache<OnboardingState>(ONBOARDING_KEY) ?? null, isLoading: false });
      return;
    }
    await readThrough<OnboardingState>({
      resourceKey: ONBOARDING_KEY,
      fetcher: async () => (await apiClient.get<OnboardingState>('/onboarding')).data,
      apply: (data) => set({ state: data, isLoading: false }),
      // A failed revalidation is silent while there is a local copy on screen.
      onError: (error, hadCache) => set({ isLoading: false, error: hadCache ? null : getErrorMessage(error) }),
    });
  },

  // Grava no aparelho e envia em segundo plano: salvar o perfil nunca espera a
  // rede. "Último vence": uma segunda gravação ainda na fila substitui a primeira.
  saveProfile: async (input) => {
    set({ error: null });
    try {
      enqueueWrite({
        method: 'PUT',
        url: '/onboarding/profile',
        body: input,
        dedupeKey: 'profile',
        idempotent: true,
        optimistic: [{
          key: ONBOARDING_KEY,
          apply: (cur?: OnboardingState) => (cur ? { ...cur, profile: mergeProfile(cur.profile, input) } : undefined),
        }],
      });
      set((current) => {
        const state = current.state ? { ...current.state, profile: mergeProfile(current.state.profile, input) } : null;
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
