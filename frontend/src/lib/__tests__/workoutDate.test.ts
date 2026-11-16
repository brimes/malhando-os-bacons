// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discardPendingWrites, getQueue, patchCacheLocally, readCache, useOfflineStore } from '../offlineStore';
import { changeWorkoutDate, FutureDateError, shiftWorkout, startedBeforeToday } from '../workoutDate';
import { FinishDateDialog } from '../../components/treinos/FinishDateDialog';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { Workout } from '../../types';

vi.mock('../network', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../network')>()),
  isNetworkOnline: () => false,
}));

const iso = (d: Date) => d.toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

function workout(over: Partial<Workout> = {}): Workout {
  const start = hoursAgo(26);
  return {
    id: 7, user_id: 1, name: 'Treino A', date: iso(start), status: 'completed',
    started_at: iso(start), finished_at: iso(new Date(start.getTime() + 50 * 60_000)),
    duration_minutes: 50, training_plan_day_id: 3, created_at: iso(start), ...over,
  };
}

describe('mudar a data do treino', () => {
  beforeEach(() => {
    localStorage.clear();
    discardPendingWrites();
    localStorage.setItem('mob_user', JSON.stringify({ id: 1 }));
    useOfflineStore.setState({ isOnline: false, cache: {} });
  });

  it('shiftWorkout preserva a duração e não deixa o fim no futuro', () => {
    const w = workout();
    const target = hoursAgo(72);
    const s = shiftWorkout(w, target);
    expect(new Date(s.finished_at!).getTime() - new Date(s.started_at!).getTime()).toBe(50 * 60_000);
    const near = new Date(Date.now() - 10 * 60_000);
    const clamped = shiftWorkout(workout({ finished_at: iso(new Date(new Date(w.date).getTime() + 120 * 60_000)) }), near);
    expect(new Date(clamped.finished_at!).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('recusa data futura e não enfileira nada', () => {
    expect(() => changeWorkoutDate(workout(), new Date(Date.now() + 3_600_000))).toThrow(FutureDateError);
    expect(getQueue()).toHaveLength(0);
  });

  it('offline: enfileira o PUT e atualiza detalhe, listas, calendário e dashboard na hora', () => {
    const w = workout();
    const oldDay = w.date.slice(0, 10);
    const target = hoursAgo(72);
    const newDay = (() => { const d = target; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
    const other = workout({ id: 8, date: iso(hoursAgo(5)) });
    patchCacheLocally('get:/workouts/7', w);
    patchCacheLocally('get:/workouts', [other, w]);
    patchCacheLocally('get:/workouts/calendar?month=' + oldDay.slice(0, 7), { month: oldDay.slice(0, 7), days: [{ date: oldDay, count: 1 }] });
    patchCacheLocally('get:/dashboard?date=2026-01-01', {
      weekly_workouts: [w], workout_stats: { total_workouts: 1, workouts_this_week: 1, workouts_this_month: 1, total_sets: 0, total_volume_kg: 0, streak_days: 1 },
      next_workout: { plan_id: 1, plan_name: 'P', day_id: 3, day_name: 'D', focus: '', last_done_at: w.date, exercises: [], total_sets: 0 },
    });
    patchCacheLocally('get:/training-plans/1', { days: [{ id: 3, last_done_at: w.date }] });

    changeWorkoutDate(w, target);

    const queue = getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].method).toBe('PUT');
    expect(queue[0].url).toBe('/workouts/7/date');
    expect((queue[0].body as { date: string }).date).toBe(iso(target));

    expect(readCache<Workout>('get:/workouts/7')!.date).toBe(iso(target));
    const list = readCache<Workout[]>('get:/workouts')!;
    expect(list.map((x) => x.id)).toEqual([8, 7]);
    expect(list[1].date).toBe(iso(target));
    const calendar = readCache<{ days: Array<{ date: string; count: number }> }>('get:/workouts/calendar?month=' + oldDay.slice(0, 7))!;
    expect(calendar.days.find((d) => d.date === oldDay)).toBeUndefined();
    void newDay;
    const dash = readCache<any>('get:/dashboard?date=2026-01-01')!; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(dash.weekly_workouts[0].date).toBe(iso(target));
    expect(dash.next_workout.last_done_at).toBe(iso(target));
    expect(readCache<any>('get:/training-plans/1')!.days[0].last_done_at).toBe(iso(target)); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('segunda escolha substitui a primeira na fila', () => {
    const w = workout();
    changeWorkoutDate(w, hoursAgo(48));
    changeWorkoutDate(w, hoursAgo(72));
    expect(getQueue()).toHaveLength(1);
  });
});

describe('diálogo de data ao finalizar', () => {
  it('só quando o início é anterior a hoje', () => {
    const now = new Date(2026, 10, 15, 9, 0);
    expect(startedBeforeToday(new Date(2026, 10, 14, 22, 0), now)).toBe(true);
    expect(startedBeforeToday(new Date(2026, 10, 15, 0, 5), now)).toBe(false);
    expect(startedBeforeToday(undefined, now)).toBe(false);
  });

  it('mostra as duas opções com a data do início', () => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const html = renderToStaticMarkup(createElement(FinishDateDialog, { startedAt: y, onChoose: () => undefined, onClose: () => undefined }));
    const p = (n: number) => String(n).padStart(2, '0');
    const label = `${p(y.getDate())}/${p(y.getMonth() + 1)}`;
    expect(html).toContain(`Este treino foi ontem, ${label}?`);
    expect(html).toContain(`Sim, foi ${label}`);
    expect(html).toContain('Não, foi hoje');
  });
});
