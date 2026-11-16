// Aritmética pura de "mudar a data do treino", compartilhada entre a escrita
// (`workoutDate.ts`) e a sobreposição de datas pendentes na leitura
// (`pendingWorkoutDates.ts`). Sem store, sem rede.

import type { Workout, WorkoutStats } from '../types';
import { startOfWeek } from './planProgress';

export const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` no calendário local do aparelho. */
export function localDay(value: Date | string | number): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

export function monthKey(day: string): string {
  return day.slice(0, 7);
}

export function inSameWeek(a: Date, b: Date): boolean {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}

export function adjustStats(stats: WorkoutStats, oldDate: Date, newDate: Date, now: Date): WorkoutStats {
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

/** `last_done_at` é o MAX das datas; sem o segundo maior, só dá para acertar quando a nova é mais recente ou a antiga era a última. */
export function lastDone(current: string | undefined, oldDate: Date, newDate: Date): string {
  if (!current) return newDate.toISOString();
  const cur = new Date(current).getTime();
  if (newDate.getTime() > cur || Math.abs(cur - oldDate.getTime()) < 1000) return newDate.toISOString();
  return current;
}

