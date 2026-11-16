import axios from 'axios';
import { apiClient } from './client';
import {
  appendLocalSet,
  applyChecklistLocally,
  dayIdForActiveWorkout,
  dropQueuedMutations,
  enqueueMutation,
  enqueueWrite,
  invalidateCache,
  isConnectivityError,
  isMutationInFlight,
  newClientSessionId,
  parseCloseRoute,
  prepareLocalSession,
  readCachedActiveWorkout,
  reconcileActiveSessionRead,
  removeLocalSet,
  requestFlush,
  resourceKeyForRequest,
  storeLocalActiveWorkout,
  takeLocalId,
} from '../lib/offline';
import type { MutationMethod } from '../types/offline';
import type {
  TrainingPlan, TrainingPlanDay,
  Workout, CreateWorkoutInput, WorkoutStats, WorkoutCalendarData,
  ActiveWorkout, CompleteSetInput, WorkoutSet, CompleteWorkoutInput, WorkoutSubstitutionInput,
} from '../types';

/** How long "is there a session on the server?" may take when the device has none. */
const ACTIVE_READ_TIMEOUT_MS = 3000;
const ACTIVE_CACHE_KEY = resourceKeyForRequest('/workouts/active');

/**
 * Queues a session write and hands it to the background sender. The training
 * plan day of a finish/complete is stamped now, while the local session that
 * knows it still exists (see `pendingCompletedWorkouts`).
 */
function queueSessionWrite(input: { method: MutationMethod; url: string; body?: unknown; localEntityId?: number }): void {
  const closing = parseCloseRoute(input.url);
  enqueueMutation({
    ...input,
    trainingPlanDayId: closing ? dayIdForActiveWorkout(closing.workoutId) : undefined,
  });
  // Deferred a tick so the screen paints its own update first.
  setTimeout(requestFlush, 0);
}

function closeSessionLocally(workoutId: number, action: '/finish' | '/complete', body: unknown): Workout {
  const local = readCachedActiveWorkout();
  const base = local && local.workout.id === workoutId ? local.workout : undefined;
  queueSessionWrite({ method: 'POST', url: `/workouts/${workoutId}${action}`, body });
  storeLocalActiveWorkout(null);
  invalidateCache(ACTIVE_CACHE_KEY);
  const now = new Date().toISOString();
  return {
    id: workoutId,
    user_id: 0,
    name: base?.name ?? '',
    date: base?.date ?? now,
    training_plan_day_id: base?.training_plan_day_id,
    status: 'completed',
    started_at: base?.started_at,
    finished_at: now,
    sets: base?.sets,
    created_at: base?.created_at ?? now,
  };
}

export const workoutsApi = {
  // Sem date traz os treinos recentes; com date (YYYY-MM-DD) traz só aquele dia.
  list: async (date?: string): Promise<Workout[]> => {
    const { data } = await apiClient.get<Workout[]>('/workouts', date ? { params: { date } } : undefined);
    return data;
  },

  // A janela inteira numa requisição. Sem isto, manter 60 dias no aparelho
  // seriam 60 chamadas — uma por dia. Teto de 90 dias no servidor.
  listRange: async (from: string, to: string, signal?: AbortSignal): Promise<Workout[]> => {
    const { data } = await apiClient.get<Workout[]>('/workouts', { params: { from, to }, signal });
    return data;
  },

  get: async (id: number): Promise<Workout> => {
    const { data } = await apiClient.get<Workout>(`/workouts/${id}`);
    return data;
  },

  // Free workout log: local-first too. No server-side dedupe key exists for it,
  // so it is not marked idempotent — a timeout on replay is parked with an
  // explanation instead of risking a duplicate.
  create: async (input: CreateWorkoutInput): Promise<Workout> => {
    const now = new Date().toISOString();
    const { entityId } = enqueueWrite({ method: 'POST', url: '/workouts', body: input, createsEntity: true });
    return {
      id: entityId as number,
      user_id: 0,
      name: input.name,
      date: input.date,
      notes: input.notes,
      training_plan_day_id: input.training_plan_day_id,
      duration_minutes: input.duration_minutes,
      status: 'completed',
      created_at: now,
    };
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

  // Guided session — every write below is LOCAL-FIRST. The effect lands on the
  // device (session slot, queue) before anything else and the call resolves right
  // away; the send happens in the background (`requestFlush`) and keeps retrying
  // with backoff. Nothing here waits for the server, so a gym with no signal, a
  // wifi that answers nothing and a plain good connection all feel identical.
  // The keys the server dedupes on (`client_session_id`, `client_set_id`) make
  // every resend safe.
  start: async (
    trainingPlanDayId: number,
    source?: { plan: TrainingPlan; day: TrainingPlanDay },
  ): Promise<ActiveWorkout> => {
    const { session, clientSessionId, workoutId, resumed } = prepareLocalSession({ trainingPlanDayId, source });
    if (resumed) return session;
    queueSessionWrite({
      method: 'POST',
      url: '/workouts/start',
      body: { training_plan_day_id: trainingPlanDayId, client_session_id: clientSessionId },
      localEntityId: workoutId,
    });
    return session;
  },

  // The local slot answers at once when there is a session on this device.
  // Without one, the server is asked — briefly, since "no workout" is the normal
  // answer and a stalled link must not hold the screen hostage.
  active: async (): Promise<ActiveWorkout | null> => {
    const local = readCachedActiveWorkout();
    if (local && local.workout.status === 'in_progress') return local;
    try {
      const response = await apiClient.get<ActiveWorkout>('/workouts/active', { timeout: ACTIVE_READ_TIMEOUT_MS });
      return reconcileActiveSessionRead(response.status === 204 ? null : response.data);
    } catch (error) {
      // A stalled link or a server hiccup is "nothing to resume", never a screen error.
      if (isConnectivityError(error) || (axios.isAxiosError(error) && (error.response?.status ?? 0) >= 500)) return local ?? null;
      throw error;
    }
  },

  completeSet: async (workoutId: number, input: CompleteSetInput): Promise<WorkoutSet> => {
    // The key is minted here, once, and travels with the body — including into
    // the offline queue. That is what makes a replay safe: the server derives
    // `set_number` from what it already has, so a resent series would otherwise
    // be silently relabelled as the next one instead of recognised as a repeat.
    const body: CompleteSetInput = { ...input, client_set_id: input.client_set_id ?? newClientSessionId() };
    const now = new Date().toISOString();
    const set: WorkoutSet = {
      id: takeLocalId(),
      workout_id: workoutId,
      exercise_name: input.exercise_name,
      sets: 0,
      reps: input.reps,
      tracking_type: input.tracking_type,
      duration_seconds: input.duration_seconds,
      weight_kg: input.weight_kg,
      training_plan_exercise_id: input.training_plan_exercise_id,
      set_number: input.set_number,
      client_set_id: body.client_set_id,
      completed_at: now,
      created_at: now,
    };
    appendLocalSet(workoutId, set);
    queueSessionWrite({ method: 'POST', url: `/workouts/${workoutId}/sets`, body, localEntityId: set.id });
    return set;
  },

  // Undoes a series. One still waiting in the queue just never gets sent; one
  // the server may already have (in flight or synced) is deleted with a queued
  // DELETE, whose id is rewritten if the series was still on a local id.
  deleteSet: async (workoutId: number, set: Pick<WorkoutSet, 'id' | 'client_set_id'>): Promise<void> => {
    const url = `/workouts/${workoutId}/sets`;
    const dropped = dropQueuedMutations((mutation) => (
      mutation.method === 'POST'
      && mutation.url === url
      && !isMutationInFlight(mutation.localId)
      && (mutation.body as { client_set_id?: unknown } | undefined)?.client_set_id === set.client_set_id
      && set.client_set_id !== undefined
    ));
    removeLocalSet(workoutId, set.id);
    if (dropped > 0) return;
    queueSessionWrite({ method: 'DELETE', url: `${url}/${set.id}` });
  },

  finish: async (workoutId: number, notes = ''): Promise<Workout> => {
    return closeSessionLocally(workoutId, '/finish', { notes });
  },

  // Logs a checklist in bulk and closes the session in one call — used by the
  // quick log and by finishing a guided session early.
  complete: async (workoutId: number, input: CompleteWorkoutInput): Promise<Workout> => {
    return closeSessionLocally(workoutId, '/complete', input);
  },

  // Same checklist as complete, but leaves the session open so the guided mode
  // can carry on from what was already ticked.
  progress: async (workoutId: number, input: CompleteWorkoutInput): Promise<ActiveWorkout | null> => {
    const updated = applyChecklistLocally(workoutId, input.exercises);
    queueSessionWrite({ method: 'POST', url: `/workouts/${workoutId}/progress`, body: input });
    return updated;
  },

  cancel: async (workoutId: number): Promise<void> => {
    queueSessionWrite({ method: 'POST', url: `/workouts/${workoutId}/cancel` });
    storeLocalActiveWorkout(null);
    invalidateCache(ACTIVE_CACHE_KEY);
  },

  // Aplica uma troca de exercício confirmada na tela — normalmente a proposta
  // que veio do chat. Sempre online (ver ONLINE_ONLY_PATHS em offlineSync.ts):
  // depende do servidor resolver o vídeo do novo nome e devolver a sessão
  // atualizada, e enfileirada a pessoa continuaria vendo o exercício antigo
  // achando que já trocou.
  substitute: async (workoutId: number, input: WorkoutSubstitutionInput): Promise<ActiveWorkout> => {
    const { data } = await apiClient.post<ActiveWorkout>(`/workouts/${workoutId}/substitutions`, input);
    return data;
  },
};
