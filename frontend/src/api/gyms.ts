import { apiClient } from './client';
import type { Gym, GymInput } from '../types';

// Sem cache local dedicado: a lista é pequena e muda pouco, e o `apiClient` já
// guarda a última resposta de todo GET (ver `client.ts`), o que basta para as
// telas simples de academia funcionarem offline em modo leitura.
export const gymsApi = {
  list: async (): Promise<Gym[]> => (await apiClient.get<Gym[]>('/gyms')).data,
  get: async (id: number): Promise<Gym> => (await apiClient.get<Gym>(`/gyms/${id}`)).data,
  create: async (input: GymInput): Promise<Gym> => (await apiClient.post<Gym>('/gyms', input)).data,
  // Substitui a lista de aparelhos inteira — não há PATCH incremental no servidor.
  update: async (id: number, input: GymInput): Promise<Gym> => (await apiClient.put<Gym>(`/gyms/${id}`, input)).data,
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/gyms/${id}`);
  },
};
