// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discardPendingWrites, getQueue, readLocalActiveSession, writeLocalActiveSession, useOfflineStore } from '../offlineStore';
import { dismissAutoFinishNotice, estimateSessionMinutes, readAutoFinishNotice, runAutoFinish } from '../autoFinish';
import type { ActiveWorkout, TrainingPlanExercise } from '../../types';

vi.mock('../network', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../network')>()),
  isNetworkOnline: () => false,
}));

const MIN = 60_000;
const START = new Date(2026, 10, 14, 18, 0).getTime();

function exercise(id: number, over: Partial<TrainingPlanExercise> = {}): TrainingPlanExercise {
  return { id, exercise_name: `Ex ${id}`, sets: 3, reps: 10, tracking_type: 'reps', rest_seconds: 60, notes: '', ...over };
}

function session(over: Partial<ActiveWorkout['workout']> = {}): ActiveWorkout {
  return {
    day_name: 'Treino A',
    exercises: [exercise(1, { last_weight_kg: 20 }), exercise(2, { last_weight_kg: 40 })],
    workout: {
      id: -3, user_id: 1, name: 'Treino A', date: new Date(START).toISOString(), status: 'in_progress',
      started_at: new Date(START).toISOString(), training_plan_day_id: 9, created_at: new Date(START).toISOString(), sets: [], ...over,
    },
  };
}

// Sem plano em cache: 6 séries × (45 s + 60 s) = 10,5 min → mínimo de 30 min → limiar 90 min.
describe('finalização automática', () => {
  beforeEach(() => {
    localStorage.clear();
    discardPendingWrites();
    localStorage.setItem('mob_user', JSON.stringify({ id: 1 }));
    useOfflineStore.setState({ isOnline: false, cache: {} });
    writeLocalActiveSession(session());
  });

  it('estima o mínimo de 30 min quando não há plano', () => {
    expect(estimateSessionMinutes(session())).toBe(30);
  });

  it('antes de 3× o estimado não faz nada', () => {
    expect(runAutoFinish(START + 89 * MIN)).toBeNull();
    expect(getQueue()).toHaveLength(0);
    expect(readLocalActiveSession()).not.toBeNull();
  });

  it('depois de 3×: enfileira /complete com fim = início + estimado e limpa a sessão', () => {
    const notice = runAutoFinish(START + 20 * 60 * MIN);
    expect(notice?.workoutId).toBe(-3);
    const queue = getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].method).toBe('POST');
    expect(queue[0].url).toBe('/workouts/-3/complete');
    expect(queue[0].trainingPlanDayId).toBe(9);
    const body = queue[0].body as { finished_at: string; exercises: Array<{ training_plan_exercise_id: number; sets_done: number; weight_kg: number }> };
    expect(new Date(body.finished_at).getTime()).toBe(START + 30 * MIN);
    expect(body.exercises).toEqual([
      { training_plan_exercise_id: 1, sets_done: 3, weight_kg: 20 },
      { training_plan_exercise_id: 2, sets_done: 3, weight_kg: 40 },
    ]);
    expect(readLocalActiveSession()).toBeNull();
  });

  it('usa a última carga digitada na sessão, não a memorizada', () => {
    writeLocalActiveSession(session({
      sets: [{ id: -9, workout_id: -3, exercise_name: 'Ex 1', sets: 1, reps: 10, tracking_type: 'reps', weight_kg: 32.5, training_plan_exercise_id: 1, set_number: 1, created_at: new Date(START + 5 * MIN).toISOString() }],
    }));
    runAutoFinish(START + 400 * MIN);
    const body = getQueue()[0].body as { exercises: Array<{ training_plan_exercise_id: number; weight_kg: number }> };
    expect(body.exercises.find((e) => e.training_plan_exercise_id === 1)!.weight_kg).toBe(32.5);
  });

  it('o aviso aparece uma vez só', () => {
    runAutoFinish(START + 400 * MIN);
    expect(readAutoFinishNotice()?.workoutId).toBe(-3);
    dismissAutoFinishNotice();
    expect(readAutoFinishNotice()).toBeNull();
    // Sem sessão aberta, rodar de novo não recria nada.
    expect(runAutoFinish(START + 500 * MIN)).toBeNull();
    expect(readAutoFinishNotice()).toBeNull();
    expect(getQueue()).toHaveLength(1);
  });

  it('sessão já concluída manualmente não é afetada', () => {
    writeLocalActiveSession(null);
    expect(runAutoFinish(START + 999 * MIN)).toBeNull();
    writeLocalActiveSession(session({ status: 'completed' }));
    expect(runAutoFinish(START + 999 * MIN)).toBeNull();
    expect(getQueue()).toHaveLength(0);
  });
});
