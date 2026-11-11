import { apiClient } from './client';

// 'outdated': ilustração antiga (imagem única); o app pede a regeneração sozinho.
export type IllustrationStatus = 'pending' | 'ready' | 'failed' | 'outdated';

export interface IllustrationState {
  status: IllustrationStatus;
  error?: string;
  /** Quadros do movimento. Ausente numa API antiga: conta como 1. */
  frames?: number;
}

// Todas as chamadas são online-only e não-cacheáveis (ver client.ts e
// offlineSync.ts): o estado de uma geração em curso não vale nada depois, e a
// imagem pronta tem armazenamento próprio em lib/illustrations.
export const exerciseIllustrationsApi = {
  // 202 quando a geração começou; 200 quando já existia (pronta ou em curso).
  // 409: o exercício tem vídeo. 429: limite diário. 503: indisponível.
  request: async (exerciseName: string): Promise<IllustrationState> => (
    await apiClient.post<IllustrationState>('/exercise-illustrations', { exercise_name: exerciseName })
  ).data,
  // 404 quando nunca foi pedida.
  status: async (exerciseName: string): Promise<IllustrationState> => (
    await apiClient.get<IllustrationState>('/exercise-illustrations', { params: { name: exerciseName } })
  ).data,
  // "Não ficou bom": refaz descrição e quadros. Consome a cota diária (429).
  regenerate: async (exerciseName: string): Promise<IllustrationState> => (
    await apiClient.post<IllustrationState>('/exercise-illustrations/regenerate', { exercise_name: exerciseName })
  ).data,
  // A rota exige Authorization, que um <img src> não carrega: busca o blob.
  imageBlob: async (exerciseName: string, frame = 0): Promise<Blob> => (
    await apiClient.get('/exercise-illustrations/image', {
      params: { name: exerciseName, frame },
      responseType: 'blob',
      timeout: 30000,
    })
  ).data as Blob,
};
