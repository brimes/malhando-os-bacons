// @vitest-environment jsdom
// Treino local-first: iniciar, registrar 3 séries e finalizar nunca esperam o
// servidor, em nenhum estado de rede, e a sincronização final entrega
// start/séries/finish na ordem, uma vez só (o "servidor" falso deduplica como o
// real: client_session_id, client_set_id, 404 em treino já encerrado).
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../api/client';
import { workoutsApi } from '../../api/workouts';
import { cancelScheduledRetry, flushQueue } from '../offlineSync';
import { discardPendingWrites, getQueue, useOfflineStore } from '../offlineStore';
import type { TrainingPlan, TrainingPlanDay } from '../../types';

vi.mock('../network', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../network')>()),
  isNetworkOnline: () => true,
}));

type Mode = 'down' | 'hang' | 'error500' | 'up';

function fakeServer() {
  const state = { mode: 'up' as Mode, workouts: new Map<string, { id: number; status: string; sets: Map<string, number> }>(), nextId: 100, log: [] as string[], raw: 0 };
  apiClient.defaults.adapter = async (config) => {
    state.raw += 1;
    const fail = (code: string, status?: number) => {
      const response = status ? { data: { error: 'x' }, status, statusText: '', headers: {}, config } : undefined;
      throw new axios.AxiosError('x', code, config, null, response as never);
    };
    if (state.mode === 'down') fail('ERR_NETWORK');
    if (state.mode === 'hang') fail('ECONNABORTED');
    if (state.mode === 'error500') fail('ERR_BAD_RESPONSE', 500);
    const ok = (status: number, data: unknown) => ({ data, status, statusText: '', headers: { 'content-type': 'application/json' }, config });
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : (config.data ?? {});
    const url = config.url ?? '';
    if (url === '/workouts/start') {
      let w = state.workouts.get(body.client_session_id);
      if (!w) {
        w = { id: state.nextId++, status: 'in_progress', sets: new Map() };
        state.workouts.set(body.client_session_id, w);
        state.log.push('start');
      }
      return ok(200, { workout: { id: w.id, status: w.status }, exercises: [] }) as never;
    }
    const m = url.match(/^\/workouts\/(\d+)\/(sets|finish)$/);
    const w = m && [...state.workouts.values()].find((x) => x.id === Number(m[1]));
    if (!m || !w || w.status !== 'in_progress') fail('ERR_BAD_REQUEST', 404);
    if (m![2] === 'sets') {
      const existing = w!.sets.get(body.client_set_id);
      if (existing) return ok(200, { id: existing }) as never;
      const id = state.nextId++;
      w!.sets.set(body.client_set_id, id);
      state.log.push('set');
      return ok(201, { id }) as never;
    }
    w!.status = 'completed';
    state.log.push('finish');
    return ok(200, { id: w!.id }) as never;
  };
  return state;
}

const day: TrainingPlanDay = {
  id: 7, name: 'Treino A', day_number: 1, focus: 'Peito',
  exercises: [{ id: 70, exercise_name: 'Supino', sets: 3, reps: 10, tracking_type: 'reps', rest_seconds: 60 }],
} as TrainingPlanDay;
const plan = { id: 3, name: 'Plano', days: [day] } as unknown as TrainingPlan;

async function runWorkout() {
  const session = await workoutsApi.start(7, { plan, day });
  expect(session.workout.id).toBeLessThan(0);
  for (let n = 1; n <= 3; n += 1) {
    await workoutsApi.completeSet(session.workout.id, {
      training_plan_exercise_id: 70, exercise_name: 'Supino', set_number: n, reps: 10, weight_kg: 40, tracking_type: 'reps',
    });
  }
  expect(await workoutsApi.active()).toMatchObject({ workout: { sets: expect.any(Array) } });
  await workoutsApi.finish(session.workout.id);
  return session;
}

async function drain(server: ReturnType<typeof fakeServer>, rounds = 30) {
  for (let i = 0; i < rounds && getQueue().length > 0; i += 1) {
    await vi.advanceTimersByTimeAsync(61_000);
    await flushQueue({ force: true });
  }
  expect(server.mode).toBe('up');
}

describe('treino local-first', () => {
  let server: ReturnType<typeof fakeServer>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    localStorage.setItem('mob_token', 't');
    localStorage.setItem('mob_user', JSON.stringify({ id: 9 }));
    discardPendingWrites();
    useOfflineStore.setState({ isOnline: true, activeSession: null });
    server = fakeServer();
  });
  afterEach(() => {
    cancelScheduledRetry();
    vi.useRealTimers();
  });

  for (const mode of ['down', 'hang', 'error500'] as const) {
    it(`com a rede em "${mode}": nada espera, nada se perde e sincroniza uma vez`, async () => {
      server.mode = mode;
      await runWorkout();
      // A tela já viu tudo concluído: slot fechado e a fila guarda os 5 envios.
      expect(await workoutsApi.active()).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(getQueue().map((m) => `${m.method} ${m.url.replace(/\/workouts\/-\d+/, '/workouts/L')}`)).toEqual([
        'POST /workouts/start', 'POST /workouts/L/sets', 'POST /workouts/L/sets', 'POST /workouts/L/sets', 'POST /workouts/L/finish',
      ]);
      expect(getQueue().every((m) => m.userId === 9)).toBe(true);

      server.mode = 'up';
      await drain(server);
      expect(getQueue()).toHaveLength(0);
      expect(useOfflineStore.getState().failed).toHaveLength(0);
      expect(server.workouts.size).toBe(1);
      expect([...server.workouts.values()][0]).toMatchObject({ status: 'completed' });
      expect(server.log).toEqual(['start', 'set', 'set', 'set', 'finish']);
    });
  }

  it('com rede boa: o envio acontece sozinho em segundo plano', async () => {
    await runWorkout();
    await vi.advanceTimersByTimeAsync(5);
    await flushQueue();
    await vi.advanceTimersByTimeAsync(5);
    await flushQueue();
    expect(getQueue()).toHaveLength(0);
    expect(server.log).toEqual(['start', 'set', 'set', 'set', 'finish']);
  });

  it('timeout seguido de sucesso não duplica nem parte a fila (chaves de idempotência)', async () => {
    server.mode = 'hang';
    await runWorkout();
    await flushQueue({ force: true });
    expect(useOfflineStore.getState().failed).toHaveLength(0);
    expect(getQueue()).toHaveLength(5);
    server.mode = 'up';
    await drain(server);
    expect(server.log).toEqual(['start', 'set', 'set', 'set', 'finish']);
  });

  it('desfazer uma série ainda na fila só a tira da fila', async () => {
    server.mode = 'down';
    const session = await workoutsApi.start(7, { plan, day });
    const set = await workoutsApi.completeSet(session.workout.id, {
      training_plan_exercise_id: 70, exercise_name: 'Supino', set_number: 1, reps: 10, weight_kg: 40, tracking_type: 'reps',
    });
    await workoutsApi.deleteSet(session.workout.id, set);
    expect(getQueue().map((m) => m.url)).toEqual(['/workouts/start']);
    expect((await workoutsApi.active())?.workout.sets).toHaveLength(0);
  });
});
