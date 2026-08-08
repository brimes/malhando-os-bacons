import axios from 'axios';
import { apiClient } from './client';
import type { ApplyProgressReviewInput, ProgressReview } from '../types';

export const progressReviewsApi = {
  /**
   * Enfileira a análise e devolve a linha ainda `pending` — o assistente leva
   * minutos, então quem chama faz polling em `get`. Um 409 significa que já
   * existe uma avaliação em andamento (índice parcial no banco); em vez de
   * virar erro na tela, ela é devolvida para a tela se acoplar à que já está
   * rodando.
   */
  create: async (): Promise<ProgressReview> => {
    try {
      const { data } = await apiClient.post<ProgressReview>('/progress-reviews');
      return data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409 && error.response.data) {
        return error.response.data as ProgressReview;
      }
      throw error;
    }
  },

  get: async (id: number): Promise<ProgressReview> => (
    await apiClient.get<ProgressReview>(`/progress-reviews/${id}`)
  ).data,

  /** 204 quando a pessoa nunca pediu uma avaliação. */
  latest: async (): Promise<ProgressReview | null> => {
    const { data, status } = await apiClient.get<ProgressReview | null>('/progress-reviews/latest');
    return status === 204 ? null : data;
  },

  apply: async (id: number, input: ApplyProgressReviewInput): Promise<ProgressReview> => (
    await apiClient.post<ProgressReview>(`/progress-reviews/${id}/apply`, input)
  ).data,

  discard: async (id: number): Promise<ProgressReview> => (
    await apiClient.post<ProgressReview>(`/progress-reviews/${id}/discard`)
  ).data,
};
