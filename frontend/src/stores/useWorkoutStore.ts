import { create } from 'zustand';
import { workoutsApi } from '../api/workouts';
import type { Workout, WorkoutStats, CreateWorkoutInput } from '../types';

interface WorkoutState {
  workouts: Workout[];
  selectedWorkout: Workout | null;
  stats: WorkoutStats | null;
  isLoading: boolean;
  error: string | null;

  fetchWorkouts: () => Promise<void>;
  fetchWorkout: (id: number) => Promise<void>;
  fetchStats: () => Promise<void>;
  createWorkout: (input: CreateWorkoutInput) => Promise<Workout>;
  updateWorkout: (id: number, input: Partial<CreateWorkoutInput>) => Promise<void>;
  deleteWorkout: (id: number) => Promise<void>;
  clearError: () => void;
}

export const useWorkoutStore = create<WorkoutState>((set, get) => ({
  workouts: [],
  selectedWorkout: null,
  stats: null,
  isLoading: false,
  error: null,

  fetchWorkouts: async () => {
    set({ isLoading: true, error: null });
    try {
      const workouts = await workoutsApi.list();
      set({ workouts, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  fetchWorkout: async (id: number) => {
    set({ isLoading: true, error: null });
    try {
      const workout = await workoutsApi.get(id);
      set({ selectedWorkout: workout, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  fetchStats: async () => {
    try {
      const stats = await workoutsApi.stats();
      set({ stats });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  createWorkout: async (input: CreateWorkoutInput) => {
    set({ isLoading: true, error: null });
    try {
      const workout = await workoutsApi.create(input);
      set((state) => ({
        workouts: [workout, ...state.workouts],
        isLoading: false,
      }));
      return workout;
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  updateWorkout: async (id: number, input: Partial<CreateWorkoutInput>) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await workoutsApi.update(id, input);
      set((state) => ({
        workouts: state.workouts.map((w) => (w.id === id ? updated : w)),
        selectedWorkout: state.selectedWorkout?.id === id ? updated : state.selectedWorkout,
        isLoading: false,
      }));
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  deleteWorkout: async (id: number) => {
    set({ isLoading: true, error: null });
    try {
      await workoutsApi.delete(id);
      set((state) => ({
        workouts: state.workouts.filter((w) => w.id !== id),
        isLoading: false,
      }));
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
