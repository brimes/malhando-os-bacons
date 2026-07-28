import { apiClient } from './client';
import type { BodyMeasurement, ResultsData, SaveBodyMeasurementInput } from '../types';

export const resultsApi = {
  get: async (): Promise<ResultsData> => (await apiClient.get<ResultsData>('/results')).data,
  save: async (input: SaveBodyMeasurementInput): Promise<BodyMeasurement> => (
    await apiClient.post<BodyMeasurement>('/results', input)
  ).data,
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/results/${id}`);
  },
};
