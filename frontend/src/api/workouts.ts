import { apiClient } from './client';
import type { Workout, CreateWorkoutInput, WorkoutStats } from '../types';

export const workoutsApi = {
  list: async (): Promise<Workout[]> => {
    const { data } = await apiClient.get<Workout[]>('/workouts');
    return data;
  },

  get: async (id: number): Promise<Workout> => {
    const { data } = await apiClient.get<Workout>(`/workouts/${id}`);
    return data;
  },

  create: async (input: CreateWorkoutInput): Promise<Workout> => {
    const { data } = await apiClient.post<Workout>('/workouts', input);
    return data;
  },

  update: async (id: number, input: Partial<CreateWorkoutInput>): Promise<Workout> => {
    const { data } = await apiClient.put<Workout>(`/workouts/${id}`, input);
    return data;
  },

  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/workouts/${id}`);
  },

  stats: async (): Promise<WorkoutStats> => {
    const { data } = await apiClient.get<WorkoutStats>('/workouts/stats');
    return data;
  },
};
