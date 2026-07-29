import { apiClient } from './client';
import { isConnectivityError, takeLocalId } from '../lib/offline';
import { newClientSessionId, openOfflineSession, readCachedActiveWorkout, reconcileActiveSessionRead } from '../lib/workoutSession';
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
  //
  // Works without a connection: the request carries an idempotency key so the
  // queue may replay it freely, and when the network is gone the session is
  // rebuilt from the plan snapshot on the device instead of failing. That is the
  // whole point — the gym is exactly where there is no signal.
  start: async (trainingPlanDayId: number): Promise<ActiveWorkout> => {
    const clientSessionId = newClientSessionId();
    const response = await apiClient.post<ActiveWorkout>('/workouts/start', {
      training_plan_day_id: trainingPlanDayId,
      client_session_id: clientSessionId,
    });
    // 202 is the offline interceptor: the POST is queued and the body is only the
    // echo of the request with a negative id, so the real session is assembled
    // here from the cached plan day.
    if (response.status !== 202) return response.data;
    const queued = response.data as unknown as { id?: number };
    return openOfflineSession({
      trainingPlanDayId,
      clientSessionId,
      // `queued.id` is a number in practice (the interceptor mints one for
      // every offline POST); the fallback is only a defensive backstop, and
      // it has to come from the same generator as everything else. A fixed
      // `-1` would very likely collide with an id already handed out — ids
      // count down from -1 — leaving two different local entities sharing one
      // id and no way for the queue to tell them apart.
      workoutId: typeof queued.id === 'number' ? queued.id : takeLocalId(),
    });
  },

  active: async (): Promise<ActiveWorkout | null> => {
    try {
      const response = await apiClient.get<ActiveWorkout>('/workouts/active');
      return reconcileActiveSessionRead(response.status === 204 ? null : response.data);
    } catch (error) {
      // Neither a live request nor the interceptor's own generic cache had an
      // answer. A session assembled entirely offline exists nowhere either of
      // those can reach — the dedicated slot is the last place to look before
      // giving up and surfacing the connectivity error to the screen.
      if (isConnectivityError(error)) {
        const local = readCachedActiveWorkout();
        if (local) return local;
      }
      throw error;
    }
  },

  completeSet: async (workoutId: number, input: CompleteSetInput): Promise<WorkoutSet> => {
    // The key is minted here, once, and travels with the body — including into
    // the offline queue. That is what makes a replay safe: the server derives
    // `set_number` from what it already has, so a resent series would otherwise
    // be silently relabelled as the next one instead of recognised as a repeat.
    // A connection dropped after the server committed is a plain network error,
    // not a timeout, so the queue does resend it.
    const body: CompleteSetInput = { ...input, client_set_id: input.client_set_id ?? newClientSessionId() };
    const { data } = await apiClient.post<WorkoutSet>(`/workouts/${workoutId}/sets`, body);
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
