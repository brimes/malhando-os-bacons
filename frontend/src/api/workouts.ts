import { apiClient } from './client';
import type {
  Workout, CreateWorkoutInput, WorkoutStats, WorkoutCalendarData,
  ActiveWorkout, CompleteSetInput, WorkoutSet, CompleteWorkoutInput,
} from '../types';

export const workoutsApi = {
  // Sem date traz os treinos recentes; com date (YYYY-MM-DD) traz só aquele dia.
  list: async (date?: string): Promise<Workout[]> => {
    const { data } = await apiClient.get<Workout[]>('/workouts', date ? { params: { date } } : undefined);
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

  calendar: async (month: string): Promise<WorkoutCalendarData> => {
    const { data } = await apiClient.get<WorkoutCalendarData>('/workouts/calendar', { params: { month } });
    return data;
  },

  // Guided session — the workout is created on start and closed on finish,
  // so progress survives a reload or a locked screen.
  start: async (trainingPlanDayId: number): Promise<ActiveWorkout> => {
    const { data } = await apiClient.post<ActiveWorkout>('/workouts/start', { training_plan_day_id: trainingPlanDayId });
    return data;
  },

  active: async (): Promise<ActiveWorkout | null> => {
    const response = await apiClient.get<ActiveWorkout>('/workouts/active');
    return response.status === 204 ? null : response.data;
  },

  completeSet: async (workoutId: number, input: CompleteSetInput): Promise<WorkoutSet> => {
    const { data } = await apiClient.post<WorkoutSet>(`/workouts/${workoutId}/sets`, input);
    return data;
  },

  deleteSet: async (workoutId: number, setId: number): Promise<void> => {
    await apiClient.delete(`/workouts/${workoutId}/sets/${setId}`);
  },

  finish: async (workoutId: number, notes = ''): Promise<Workout> => {
    const { data } = await apiClient.post<Workout>(`/workouts/${workoutId}/finish`, { notes });
    return data;
  },

  // Logs a checklist in bulk and closes the session in one call — used by the
  // quick log and by finishing a guided session early.
  complete: async (workoutId: number, input: CompleteWorkoutInput): Promise<Workout> => {
    const { data } = await apiClient.post<Workout>(`/workouts/${workoutId}/complete`, input);
    return data;
  },

  // Same checklist as complete, but leaves the session open so the guided mode
  // can carry on from what was already ticked.
  progress: async (workoutId: number, input: CompleteWorkoutInput): Promise<ActiveWorkout> => {
    const { data } = await apiClient.post<ActiveWorkout>(`/workouts/${workoutId}/progress`, input);
    return data;
  },

  cancel: async (workoutId: number): Promise<void> => {
    await apiClient.post(`/workouts/${workoutId}/cancel`);
  },
};
