// Mudar o dia de um treino já concluído ("esqueci de fechar e fechei no dia
// seguinte"). Local-first: grava na fila (`enqueueWrite`), atualiza na hora
// todo cache que a tela lê — detalhe, listas, calendário, dashboard, dia do
// plano — e devolve sem esperar rede.
//
// Rota: `PUT /workouts/{id}/date` (PUT, não PATCH: o CORS do backend só libera
// GET/POST/PUT/DELETE). O servidor desloca started_at/finished_at pelo mesmo
// intervalo, então a duração não muda.

import type { DashboardData, Workout, WorkoutCalendarData, WorkoutStats } from '../types';
import { enqueueWrite, type OptimisticUpdate } from './offlineWrite';
import { resourceKeyForRequest, useOfflineStore } from './offlineStore';
import { workoutsCache } from './local/repo/workouts';
import { startOfWeek } from './planProgress';

/** Mesma tolerância do servidor para relógio adiantado. */
export const FUTURE_SLACK_MS = 5 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` no calendário local do aparelho. */
export function localDay(value: Date | string | number): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `dd/mm` no calendário local. */
export function formatDayMonth(value: Date | string | number): string {
  const d = new Date(value);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** True quando o início caiu num dia anterior ao de hoje, no fuso do aparelho. */
export function startedBeforeToday(startedAt: string | number | Date | undefined, now: Date = new Date()): boolean {
  if (startedAt === undefined) return false;
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return false;
  return localDay(started) < localDay(now);
}

/** True quando a data pedida está no futuro (além da tolerância). */
export function isFutureDate(date: Date, now: Date = new Date()): boolean {
  return date.getTime() > now.getTime() + FUTURE_SLACK_MS;
}

/** O treino com a nova data; início e fim andam junto, o fim nunca passa de agora. */
export function shiftWorkout(workout: Workout, newDate: Date, now: Date = new Date()): Workout {
  const delta = newDate.getTime() - new Date(workout.date).getTime();
  const shifted = { ...workout, date: newDate.toISOString() };
  if (workout.started_at) shifted.started_at = new Date(new Date(workout.started_at).getTime() + delta).toISOString();
  if (workout.finished_at) {
    shifted.finished_at = new Date(Math.min(new Date(workout.finished_at).getTime() + delta, now.getTime())).toISOString();
  }
  return shifted;
}

function monthKey(day: string): string {
  return day.slice(0, 7);
}

function inSameWeek(a: Date, b: Date): boolean {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}

function adjustStats(stats: WorkoutStats, oldDate: Date, newDate: Date, now: Date): WorkoutStats {
  const next = { ...stats };
  const wasWeek = inSameWeek(oldDate, now);
  const isWeek = inSameWeek(newDate, now);
  if (wasWeek !== isWeek) next.workouts_this_week = Math.max(0, next.workouts_this_week + (isWeek ? 1 : -1));
  const wasMonth = monthKey(localDay(oldDate)) === monthKey(localDay(now));
  const isMonth = monthKey(localDay(newDate)) === monthKey(localDay(now));
  if (wasMonth !== isMonth) next.workouts_this_month = Math.max(0, next.workouts_this_month + (isMonth ? 1 : -1));
  // A sequência (streak_days) depende de dias consecutivos e é recalculada pelo
  // servidor; a próxima leitura a corrige.
  return next;
}

function queryOf(key: string): URLSearchParams {
  const index = key.indexOf('?');
  return new URLSearchParams(index === -1 ? '' : key.slice(index + 1));
}

function listFits(key: string, day: string): boolean {
  const q = queryOf(key);
  const date = q.get('date');
  if (date) return date === day;
  const from = q.get('from');
  const to = q.get('to');
  if (from && to) return day >= from && day <= to;
  return true;
}

/** As atualizações otimistas de cada cache que lê esse treino. Exportado para teste. */
export function buildOptimisticUpdates(workout: Workout, newDate: Date, now: Date = new Date()): OptimisticUpdate[] {
  const oldDate = new Date(workout.date);
  const oldDay = localDay(oldDate);
  const newDay = localDay(newDate);
  const dayId = workout.training_plan_day_id;
  const updates: OptimisticUpdate[] = [];

  for (const key of Object.keys(useOfflineStore.getState().cache)) {
    if (key === resourceKeyForRequest(`/workouts/${workout.id}`)) {
      updates.push({ key, apply: (cur: Workout | undefined) => (cur ? { ...cur, ...shiftWorkout(cur, newDate, now) } : undefined) });
    } else if (key === 'get:/workouts' || key.startsWith('get:/workouts?')) {
      updates.push({
        key,
        apply: (cur: Workout[] | undefined) => {
          if (!Array.isArray(cur)) return undefined;
          const rest = cur.filter((item) => item.id !== workout.id);
          const present = cur.find((item) => item.id === workout.id);
          const base = present ?? workout;
          const next = listFits(key, newDay) ? [...rest, { ...base, ...shiftWorkout(base, newDate, now), sets: base.sets, set_count: base.set_count }] : rest;
          return next.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        },
      });
    } else if (key.startsWith('get:/workouts/calendar')) {
      const month = queryOf(key).get('month');
      updates.push({
        key,
        apply: (cur: WorkoutCalendarData | undefined) => {
          if (!cur || !Array.isArray(cur.days)) return undefined;
          const counts = new Map(cur.days.map((d) => [d.date, d.count]));
          if (!month || monthKey(oldDay) === month) counts.set(oldDay, (counts.get(oldDay) ?? 1) - 1);
          if (!month || monthKey(newDay) === month) counts.set(newDay, (counts.get(newDay) ?? 0) + 1);
          const days = [...counts.entries()].filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
          return { ...cur, days };
        },
      });
    } else if (key === 'get:/workouts/stats') {
      updates.push({ key, apply: (cur: WorkoutStats | undefined) => (cur ? adjustStats(cur, oldDate, newDate, now) : undefined) });
    } else if (key.startsWith('get:/dashboard')) {
      updates.push({
        key,
        apply: (cur: DashboardData | undefined) => {
          if (!cur) return undefined;
          const next: DashboardData = { ...cur };
          if (Array.isArray(cur.weekly_workouts)) {
            next.weekly_workouts = cur.weekly_workouts.map((item) => (item.id === workout.id ? { ...item, ...shiftWorkout(item, newDate, now) } : item));
          }
          if (cur.workout_stats) next.workout_stats = adjustStats(cur.workout_stats, oldDate, newDate, now);
          if (dayId !== undefined && cur.next_workout?.day_id === dayId) {
            next.next_workout = { ...cur.next_workout, last_done_at: lastDone(cur.next_workout.last_done_at, oldDate, newDate) };
          }
          return next;
        },
      });
    } else if (dayId !== undefined && /^get:\/training-plans\/\d+$/.test(key)) {
      updates.push({
        key,
        apply: (cur: { days?: Array<{ id?: number; last_done_at?: string }> } | undefined) => {
          if (!cur?.days?.some((d) => d.id === dayId)) return undefined;
          return { ...cur, days: cur.days.map((d) => (d.id === dayId ? { ...d, last_done_at: lastDone(d.last_done_at, oldDate, newDate) } : d)) };
        },
      });
    }
  }
  return updates;
}

/** `last_done_at` é o MAX das datas; sem o segundo maior, só dá para acertar quando a nova é mais recente ou a antiga era a última. */
function lastDone(current: string | undefined, oldDate: Date, newDate: Date): string {
  if (!current) return newDate.toISOString();
  const cur = new Date(current).getTime();
  if (newDate.getTime() > cur || Math.abs(cur - oldDate.getTime()) < 1000) return newDate.toISOString();
  return current;
}

export class FutureDateError extends Error {
  constructor() {
    super('A data do treino não pode ser no futuro.');
    this.name = 'FutureDateError';
  }
}

/** Muda a data do treino concluído: local-first, sem esperar rede. Devolve o treino já atualizado. */
export function changeWorkoutDate(workout: Workout, newDate: Date): Workout {
  const now = new Date();
  if (isFutureDate(newDate, now)) throw new FutureDateError();
  const target = newDate.getTime() > now.getTime() ? now : newDate;
  const optimistic = buildOptimisticUpdates(workout, target, now);
  enqueueWrite({
    method: 'PUT',
    url: `/workouts/${workout.id}/date`,
    body: { date: target.toISOString() },
    // Repetir converge no mesmo estado; a segunda escolha substitui a primeira na fila.
    idempotent: true,
    dedupeKey: 'date',
    optimistic,
  });
  const updated = shiftWorkout(workout, target, now);
  // A base local de onde o histórico lê.
  if (workoutsCache.get(workout.id)) void workoutsCache.put({ ...workoutsCache.get(workout.id)!, ...updated, sets: workoutsCache.get(workout.id)!.sets });
  return updated;
}
