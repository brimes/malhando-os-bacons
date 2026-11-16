// Mudar o dia de um treino já concluído ("esqueci de fechar e fechei no dia
// seguinte"). Local-first: grava na fila (`enqueueWrite`) e devolve sem esperar
// rede. Só detalhe e listas de treinos são remendados no cache aqui (operação
// idempotente). Calendário, estatísticas, dashboard e dia do plano NÃO: a leitura
// aplica a troca pendente por cima do que vier (cache ou rede) — ver
// `pendingWorkoutDates.ts` — e remendar o cache também contaria a troca duas vezes.
//
// Rota: `PUT /workouts/{id}/date` (PUT, não PATCH: o CORS do backend só libera
// GET/POST/PUT/DELETE). O servidor desloca started_at/finished_at pelo mesmo
// intervalo, então a duração não muda.

import type { Workout } from '../types';
import { enqueueWrite, type OptimisticUpdate } from './offlineWrite';
import { resourceKeyForRequest, useOfflineStore } from './offlineStore';
import { workoutsCache } from './local/repo/workouts';
import { localDay, pad, shiftWorkout } from './workoutDateMath';
import { pendingDateChanges } from './pendingWorkoutDates';

export { localDay, shiftWorkout } from './workoutDateMath';

/** Mesma tolerância do servidor para relógio adiantado. */
export const FUTURE_SLACK_MS = 5 * 60 * 1000;

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
  const newDay = localDay(newDate);
  const updates: OptimisticUpdate[] = [];

  for (const key of Object.keys(useOfflineStore.getState().cache)) {
    if (key === resourceKeyForRequest(`/workouts/${workout.id}`)) {
      updates.push({ key, apply: (cur: Workout | undefined) => (cur ? { ...cur, ...shiftWorkout(cur, newDate, now) } : undefined) });
    } else if ((key === 'get:/workouts' || key.startsWith('get:/workouts?')) && !key.startsWith('get:/workouts/')) {
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
    }
  }
  return updates;
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
  // Segunda troca antes da primeira sair: a origem continua sendo a data que o
  // servidor conhece, não a da primeira troca.
  const earlier = pendingDateChanges().find((change) => change.id === workout.id);
  enqueueWrite({
    method: 'PUT',
    url: `/workouts/${workout.id}/date`,
    body: { date: target.toISOString() },
    // Repetir converge no mesmo estado; a segunda escolha substitui a primeira na fila.
    idempotent: true,
    dedupeKey: 'date',
    dateChange: { previousDate: earlier?.previousDate ?? workout.date, dayId: workout.training_plan_day_id ?? earlier?.dayId },
    optimistic,
  });
  const updated = shiftWorkout(workout, target, now);
  // A base local de onde o histórico lê.
  if (workoutsCache.get(workout.id)) void workoutsCache.put({ ...workoutsCache.get(workout.id)!, ...updated, sets: workoutsCache.get(workout.id)!.sets });
  return updated;
}
