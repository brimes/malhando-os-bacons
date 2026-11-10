import { apiClient } from './client';

export const authApi = {
  forgotPassword: async (email: string): Promise<string> =>
    (await apiClient.post<{ message: string }>('/auth/password/forgot', { email })).data.message,
  resetPassword: async (email: string, code: string, newPassword: string): Promise<string> =>
    (await apiClient.post<{ message: string }>('/auth/password/reset', { email, code, new_password: newPassword })).data.message,
};
