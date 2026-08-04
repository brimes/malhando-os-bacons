import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient, getErrorMessage, registerUnauthorizedHandler } from '../api/client';
import { clearOfflineData, isConnectivityError } from '../lib/offline';
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
        // The local cache and the pending queue belong to this account. On a
        // shared device the next login must not inherit either of them.
        clearOfflineData();
        set({ token: null, user: null, isAuthenticated: false });
      },

      clearError: () => set({ error: null }),

      fetchMe: async () => {
        if (!get().token) return;
        try {
          const { data } = await apiClient.get<User>('/auth/me');
          set({ user: data, isAuthenticated: true });
        } catch (error) {
          // Being offline is no reason to sign anyone out — the token is still
          // valid and the point of the offline mode is to keep working. A token
          // the server actually rejects is handled by the 401 interceptor.
          if (isConnectivityError(error)) return;
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

// Um 401 zera a sessão pelo mesmo caminho do logout manual — que preserva a
// fila offline e descarta só o cache de leitura. O `ProtectedRoute` reage ao
// estado e leva para o login sem recarregar a página.
registerUnauthorizedHandler(() => {
  if (!useAuthStore.getState().isAuthenticated) return;
  useAuthStore.getState().logout();
});
