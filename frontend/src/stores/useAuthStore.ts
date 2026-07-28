import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient, getErrorMessage } from '../api/client';
import type { User, AuthResponse } from '../types';

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
	error: string | null;

	login: (email: string, password: string) => Promise<void>;
	register: (name: string, email: string, password: string) => Promise<void>;
	loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const { data } = await apiClient.post<AuthResponse>('/auth/login', { email, password });
          localStorage.setItem('mob_token', data.token);
          set({ token: data.token, user: data.user, isAuthenticated: true, isLoading: false });
        } catch (err) {
          set({ error: getErrorMessage(err), isLoading: false });
          throw err;
        }
      },

      register: async (name: string, email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const { data } = await apiClient.post<AuthResponse>('/auth/register', { name, email, password });
          localStorage.setItem('mob_token', data.token);
          set({ token: data.token, user: data.user, isAuthenticated: true, isLoading: false });
        } catch (err) {
          set({ error: getErrorMessage(err), isLoading: false });
          throw err;
        }
      },

      loginWithGoogle: async (idToken: string) => {
        set({ isLoading: true, error: null });
        try {
          const { data } = await apiClient.post<AuthResponse>('/auth/google', {
            id_token: idToken,
          });
          localStorage.setItem('mob_token', data.token);
          set({
            token: data.token,
            user: data.user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err) {
          set({ error: getErrorMessage(err), isLoading: false });
          throw err;
        }
      },

      logout: () => {
        localStorage.removeItem('mob_token');
        set({ token: null, user: null, isAuthenticated: false });
      },

      clearError: () => set({ error: null }),

      fetchMe: async () => {
        if (!get().token) return;
        try {
          const { data } = await apiClient.get<User>('/auth/me');
          set({ user: data, isAuthenticated: true });
        } catch {
          get().logout();
        }
      },
    }),
    {
      name: 'mob-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
