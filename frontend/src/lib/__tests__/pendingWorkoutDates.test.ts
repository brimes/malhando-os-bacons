// @vitest-environment jsdom
// Troca de data pendente: o servidor ainda diz a data antiga, a leitura mostra a nova.
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../api/client';
import { workoutsApi } from '../../api/workouts';
import { cancelScheduledRetry, flushQueue } from '../offlineSync';
import { discardPendingWrites, getQueue, useOfflineStore } from '../offlineStore';
import { applyPendingToCalendar, applyPendingToDashboard, applyPendingToWindow, dayWindow, pendingDateChanges, registerWorkoutPool } from '../pendingWorkoutDates';
import { changeWorkoutDate } from '../workoutDate';
import type { DashboardData, Workout } from '../../types';

vi.mock('../network', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../network')>()),
  isNetworkOnline: () => true,
}));

const at = (daysAgo: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(12, 0, 0, 0);
  return d;
};
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const OLD = at(1);
const NEW = at(4);

function workout(over: Partial<Workout> = {}): Workout {
  return {
    id: 7, user_id: 1, name: 'Treino A', date: OLD.toISOString(), status: 'completed',
    started_at: OLD.toISOString(), finished_at: new Date(OLD.getTime() + 3_000_000).toISOString(),
    training_plan_day_id: 3, created_at: OLD.toISOString(), ...over,
  };
}

/** Servidor falso: guarda a data do treino; o PUT responde o que `putStatus` mandar. */
function fakeServer() {
  const state = { date: OLD.toISOString(), putStatus: 404 as number, puts: 0 };
  apiClient.defaults.adapter = async (config) => {
    const ok = (status: number, data: unknown) => ({ data, status, statusText: '', headers: { 'content-type': 'application/json' }, config });
    const fail = (status: number) => {
      throw new axios.AxiosError('x', 'ERR_BAD_REQUEST', config, null, { data: { error: 'x' }, status, statusText: '', headers: {}, config } as never);
    };
    const url = config.url ?? '';
    if (config.method === 'put' && url === '/workouts/7/date') {
      state.puts += 1;
      if (state.putStatus >= 400) fail(state.putStatus);
      state.date = JSON.parse(config.data as string).date;
      return ok(200, workout({ date: state.date })) as never;
    }
    if (url === '/workouts' && config.params?.date) {
      return ok(200, state.date.slice(0, 10) === config.params.date ? [workout({ date: state.date })] : []) as never;
    }
    if (url === '/workouts/calendar') {
      const month = config.params.month as string;
      return ok(200, { month, days: state.date.slice(0, 7) === month ? [{ date: state.date.slice(0, 10), count: 1 }] : [] }) as never;
    }
    if (url === '/workouts/7') return ok(200, workout({ date: state.date })) as never;
    return ok(200, []) as never;
  };
  return state;
}

describe('sobreposição de datas pendentes', () => {
  let server: ReturnType<typeof fakeServer>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    localStorage.setItem('mob_token', 't');
    localStorage.setItem('mob_user', JSON.stringify({ id: 1 }));
    discardPendingWrites();
    useOfflineStore.setState({ isOnline: true, cache: {} });
    registerWorkoutPool(() => [workout()]);
    server = fakeServer();
  });
  afterEach(() => {
    cancelScheduledRetry();
    vi.useRealTimers();
  });

  it('resposta antiga + troca pendente: dia velho sem o treino, dia novo com ele, calendário movido', async () => {
    server.putStatus = 500; // o PUT nunca chega: tudo é leitura do servidor com data antiga
    changeWorkoutDate(workout(), NEW);
    const oldDay = dayOf(OLD);
    const newDay = dayOf(NEW);
    expect(newDay).not.toBe(oldDay);

    expect(await workoutsApi.list(oldDay)).toEqual([]);
    const moved = await workoutsApi.list(newDay);
    expect(moved.map((w) => w.id)).toEqual([7]);
    expect(moved[0].date).toBe(NEW.toISOString());
    // início e fim andam juntos: a duração não muda
    expect(new Date(moved[0].finished_at!).getTime() - new Date(moved[0].started_at!).getTime()).toBe(3_000_000);

    const calendar = await workoutsApi.calendar(oldDay.slice(0, 7));
    expect(calendar.days.find((d) => d.date === oldDay)).toBeUndefined();
    expect(calendar.days.find((d) => d.date === newDay)?.count).toBe(1);
    expect((await workoutsApi.get(7)).date).toBe(NEW.toISOString());
  });

  it('404 do backend antigo mantém a troca na fila, sem falha, e a tela segue mostrando a data nova', async () => {
    server.putStatus = 404;
    changeWorkoutDate(workout(), NEW);
    await flushQueue({ force: true });
    expect(server.puts).toBeGreaterThan(0);
    expect(getQueue()).toHaveLength(1);
    expect(useOfflineStore.getState().failed).toHaveLength(0);
    expect(await workoutsApi.list(dayOf(OLD))).toEqual([]);
    expect((await workoutsApi.list(dayOf(NEW))).map((w) => w.id)).toEqual([7]);

    server.putStatus = 405;
    await flushQueue({ force: true });
    expect(getQueue()).toHaveLength(1);
    expect(useOfflineStore.getState().failed).toHaveLength(0);

    // Depois do deploy a mesma troca sai e a leitura passa a ser a do servidor.
    server.putStatus = 200;
    await flushQueue({ force: true });
    expect(getQueue()).toHaveLength(0);
    expect(pendingDateChanges()).toEqual([]);
    expect((await workoutsApi.list(dayOf(NEW))).map((w) => w.id)).toEqual([7]);
    expect(await workoutsApi.list(dayOf(OLD))).toEqual([]);
  });

  it('um 404 não trava a fila: o que vem depois sai', async () => {
    server.putStatus = 404;
    changeWorkoutDate(workout(), NEW);
    const sent: string[] = [];
    const inner = apiClient.defaults.adapter as unknown as (c: never) => Promise<never>;
    apiClient.defaults.adapter = (async (config: { url?: string; method?: string }) => {
      sent.push(`${config.method} ${config.url}`);
      return inner(config as never);
    }) as never;
    workoutsApi.cancel(9).catch(() => undefined);
    await flushQueue({ force: true });
    expect(sent).toContain('post /workouts/9/cancel');
    expect(getQueue().map((m) => m.url)).toEqual(['/workouts/7/date']);
  });

  it('segunda troca antes de sair mantém a origem que o servidor conhece', () => {
    server.putStatus = 500;
    changeWorkoutDate(workout(), at(3));
    changeWorkoutDate(workout({ date: at(3).toISOString() }), NEW);
    expect(getQueue()).toHaveLength(1);
    const [change] = pendingDateChanges();
    expect(change.date.toISOString()).toBe(NEW.toISOString());
    expect(change.previousDate).toBe(OLD.toISOString());
  });

  it('funções puras: janela, calendário e dashboard', () => {
    const changes = [{ id: 7, date: NEW, previousDate: OLD.toISOString(), dayId: 3 }];
    const kept = applyPendingToWindow([workout(), workout({ id: 8 })], dayWindow(dayOf(OLD)), changes, new Date(), []);
    expect(kept.map((w) => w.id)).toEqual([8]);
    const cal = applyPendingToCalendar({ month: dayOf(OLD).slice(0, 7), days: [{ date: dayOf(OLD), count: 2 }] }, dayOf(OLD).slice(0, 7), changes);
    expect(cal.days.find((d) => d.date === dayOf(OLD))?.count).toBe(1);
    const dash = applyPendingToDashboard({
      weekly_workouts: [workout()],
      next_workout: { plan_id: 1, plan_name: 'P', day_id: 3, day_name: 'D', focus: '', last_done_at: OLD.toISOString(), exercises: [], total_sets: 0 },
    } as unknown as DashboardData, changes);
    expect(dash.next_workout?.last_done_at).toBe(NEW.toISOString());
  });
});
