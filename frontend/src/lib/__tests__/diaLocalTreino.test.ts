// @vitest-environment jsdom
// O dia de um treino é o dia LOCAL do aparelho. Rode com TZ=America/Sao_Paulo.
// Treino feito 15/11 às 22:30 em Brasília = 2026-11-16T01:30Z: calendário e lista
// do dia têm que concordar no dia 15, nunca no 16.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Workout } from '../../types';
import { listByDate, listByRange, workoutsCache } from '../local/repo/workouts';
import { applyPendingToCalendar, applyPendingToWindow, dayWindow } from '../pendingWorkoutDates';
import { localDay } from '../workoutDateMath';
import type { PendingDateChange } from '../pendingWorkoutDates';

const LATE = '2026-11-16T01:30:00Z'; // 15/11 22:30 em Brasília

function workout(over: Partial<Workout> = {}): Workout {
  return { id: 7, user_id: 1, name: 'Treino A', date: LATE, status: 'completed', created_at: LATE, ...over };
}

describe.runIf(process.env.TZ === 'America/Sao_Paulo')('dia local do treino (UTC-3)', () => {
  beforeEach(async () => {
    await workoutsCache.ensureLoaded();
    await workoutsCache.replaceAll([workout()]);
  });

  it('localDay: 01:30Z de 16/11 é dia 15 local', () => {
    expect(localDay(LATE)).toBe('2026-11-15');
  });

  it('lista do dia (base local): aparece no 15 e não no 16', () => {
    expect(listByDate('2026-11-15').map((w) => w.id)).toEqual([7]);
    expect(listByDate('2026-11-16')).toEqual([]);
  });

  it('intervalo: o treino cai no dia 15', () => {
    expect(listByRange('2026-11-15', '2026-11-15').map((w) => w.id)).toEqual([7]);
    expect(listByRange('2026-11-16', '2026-11-20')).toEqual([]);
  });

  it('troca de data pendente para 01:30Z de 16/11: dia 15 local, não 16', () => {
    const change: PendingDateChange = { id: 7, date: new Date(LATE), previousDate: '2026-11-10T15:00:00Z' };
    const base = [workout({ date: '2026-11-10T15:00:00Z' })];
    expect(applyPendingToWindow(base, dayWindow('2026-11-15'), [change], new Date(), []).map((w) => w.id)).toEqual([7]);
    expect(applyPendingToWindow(base, dayWindow('2026-11-16'), [change], new Date(), [])).toEqual([]);
  });

  it('calendário com troca pendente marca o dia 15 local', () => {
    const change: PendingDateChange = { id: 7, date: new Date(LATE), previousDate: '2026-11-10T15:00:00Z' };
    const data = applyPendingToCalendar({ month: '2026-11', days: [{ date: '2026-11-10', count: 1 }] }, '2026-11', [change]);
    expect(data.days).toEqual([{ date: '2026-11-15', count: 1 }]);
  });
});
