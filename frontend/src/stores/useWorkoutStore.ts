import { create } from 'zustand';
import { workoutsApi } from '../api/workouts';
import { getErrorMessage } from '../api/client';
import { hasCache, patchCacheLocally, readThrough, resourceKeyForRequest } from '../lib/offline';
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

const workoutsKey = () => resourceKeyForRequest('/workouts');
const workoutKey = (id: number) => resourceKeyForRequest(`/workouts/${id}`);
const statsKey = () => resourceKeyForRequest('/workouts/stats');

export const useWorkoutStore = create<WorkoutState>((set, get) => ({
  workouts: [],
  selectedWorkout: null,
  stats: null,
  isLoading: false,
  error: null,

  // Reads hand over the local copy first and only then revalidate, so the list
  // is on screen before the request even leaves the device.
  fetchWorkouts: async () => {
    set({ isLoading: !hasCache(workoutsKey()), error: null });
    await readThrough<Workout[]>({
      resourceKey: workoutsKey(),
      fetcher: () => workoutsApi.list(),
      apply: (workouts) => set({ workouts, isLoading: false }),
      // A failed background revalidation is silent while there is a local copy:
      // the screen already shows something usable.
      onError: (error, hadCache) => set({ isLoading: false, error: hadCache ? null : getErrorMessage(error) }),
    });
  },

  fetchWorkout: async (id: number) => {
    set({ isLoading: !hasCache(workoutKey(id)), error: null });
    await readThrough<Workout>({
      resourceKey: workoutKey(id),
      fetcher: () => workoutsApi.get(id),
      apply: (workout) => set({ selectedWorkout: workout, isLoading: false }),
      onError: (error, hadCache) => set({ isLoading: false, error: hadCache ? null : getErrorMessage(error) }),
    });
  },

  fetchStats: async () => {
    await readThrough<WorkoutStats>({
      resourceKey: statsKey(),
      fetcher: () => workoutsApi.stats(),
      apply: (stats) => set({ stats }),
      onError: (error, hadCache) => {
        if (!hadCache) set({ error: getErrorMessage(error) });
      },
    });
  },

  createWorkout: async (input: CreateWorkoutInput) => {
    set({ isLoading: true, error: null });
    try {
      // Offline this resolves with an optimistic workout carrying a negative id;
      // the POST itself waits in the queue.
      const workout = await workoutsApi.create(input);
      const workouts = [workout, ...get().workouts];
      set({ workouts, isLoading: false });
      patchCacheLocally(workoutsKey(), workouts);
      return workout;
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  updateWorkout: async (id: number, input: Partial<CreateWorkoutInput>) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await workoutsApi.update(id, input);
      const workouts = get().workouts.map((workout) => (workout.id === id ? updated : workout));
      set({
        workouts,
        selectedWorkout: get().selectedWorkout?.id === id ? updated : get().selectedWorkout,
        isLoading: false,
      });
      patchCacheLocally(workoutsKey(), workouts);
      patchCacheLocally(workoutKey(id), updated);
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  deleteWorkout: async (id: number) => {
    set({ isLoading: true, error: null });
    try {
      await workoutsApi.delete(id);
      const workouts = get().workouts.filter((workout) => workout.id !== id);
      set({ workouts, isLoading: false });
      patchCacheLocally(workoutsKey(), workouts);
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
