// Sobreposição de datas pendentes: enquanto `PUT /workouts/{id}/date` está na
// fila (ou parado em falhas), o treino {id} TEM a data nova — qualquer que seja
// a cópia que a tela receba, do cache ou da rede.
//
// Por que na leitura e não só no cache: o servidor responde com a data antiga
// até processar a troca (offline, backend sem a rota, janela até a fila sair), e
// essa resposta sobrescrevia o cache otimista. A sobreposição é DERIVADA da
// fila — não há estado paralelo — então some sozinha quando a mutação sai com
// sucesso: o servidor passa a devolver a data nova e nada mais é aplicado.
//
// Tudo aqui é função pura sobre uma lista de trocas (`PendingDateChange`), que
// por padrão vem da fila atual. As leituras de `api/workouts.ts`, do dashboard e
// das telas que lêem o aparelho passam por estas funções.

import type { DashboardData, TrainingPlan, Workout, WorkoutCalendarData, WorkoutStats } from '../types';
import type { FailedMutation, PendingMutation } from '../types/offline';
import { useMemo } from 'react';
import { useOfflineStore } from './offlineStore';
import { adjustStats, lastDone, localDay, monthKey, shiftWorkout } from './workoutDateMath';
import { startOfWeek } from './planProgress';

export interface PendingDateChange {
  id: number;
  /** A data que o usuário escolheu. */
  date: Date;
  /** A data que o servidor conhece (antes de qualquer troca pendente), quando sabida. */
  previousDate?: string;
  dayId?: number;
}

const DATE_ROUTE = /^\/workouts\/(\d+)\/date(?:\?.*)?$/;

/** As trocas de data na fila e nas falhas, em ordem; a última de cada treino vence. */
export function pendingDateChanges(
  queue: PendingMutation[] = useOfflineStore.getState().queue,
  failed: FailedMutation[] = useOfflineStore.getState().failed,
): PendingDateChange[] {
  const byId = new Map<number, PendingDateChange>();
  for (const mutation of [...failed, ...queue]) {
    if (mutation.method !== 'PUT') continue;
    const match = DATE_ROUTE.exec(mutation.url);
    const raw = (mutation.body as { date?: unknown } | undefined)?.date;
    if (!match || typeof raw !== 'string') continue;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) continue;
    const id = Number(match[1]);
    const earlier = byId.get(id);
    byId.set(id, {
      id,
      date,
      previousDate: earlier?.previousDate ?? mutation.dateChange?.previousDate,
      dayId: mutation.dateChange?.dayId ?? earlier?.dayId,
    });
  }
  return [...byId.values()];
}

/** Re-renderiza quando a fila ou as falhas mudam. */
export function usePendingDateChanges(): PendingDateChange[] {
  const queue = useOfflineStore((state) => state.queue);
  const failed = useOfflineStore((state) => state.failed);
  return useMemo(() => pendingDateChanges(queue, failed), [queue, failed]);
}

// De onde buscar o treino que ainda não está na resposta do servidor para o dia
// novo (a base local de `workouts`). Registrado por `repo/workouts.ts` para esta
// camada não importar o repositório (que importa a API, que importa esta).
let poolSource: () => Workout[] = () => [];
export function registerWorkoutPool(source: () => Workout[]): void {
  poolSource = source;
}

// O dia "do calendário" é o dia LOCAL do aparelho — o mesmo em que o servidor
// agrupa (header X-Timezone). Nunca `slice(0, 10)` de um timestamp: isso é o dia
// em UTC e, após 21h em Brasília, cai no dia seguinte. Uma data pura
// (`YYYY-MM-DD`) já é um dia e passa como está.
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const calendarDay = (value: string | Date): string =>
  typeof value === 'string' && BARE_DAY.test(value) ? value : localDay(value);
const dayOf = (workout: Workout): string => calendarDay(workout.date);

function bySeenDate(a: Workout, b: Workout): number {
  return String(b.date).localeCompare(String(a.date));
}

/** Cada treino com troca pendente ganha a data nova (início e fim deslocados). */
export function applyPendingWorkoutDates(
  workouts: Workout[],
  changes: PendingDateChange[] = pendingDateChanges(),
  now: Date = new Date(),
): Workout[] {
  if (changes.length === 0) return workouts;
  const byId = new Map(changes.map((change) => [change.id, change]));
  let touched = false;
  const next = workouts.map((workout) => {
    const change = byId.get(workout.id);
    if (!change) return workout;
    touched = true;
    return shiftWorkout(workout, change.date, now);
  });
  return touched ? next : workouts;
}

/**
 * Uma janela de treinos (um dia, um intervalo) como o servidor a devolveria se
 * já soubesse das trocas: quem saiu da janela some, quem entrou aparece — mesmo
 * que a resposta não o traga, usando o treino da base local.
 */
export function applyPendingToWindow(
  workouts: Workout[],
  fits: (day: string) => boolean,
  changes: PendingDateChange[] = pendingDateChanges(),
  now: Date = new Date(),
  pool: Workout[] = poolSource(),
): Workout[] {
  if (changes.length === 0) return workouts;
  const shifted = applyPendingWorkoutDates(workouts, changes, now);
  const kept = shifted.filter((workout) => fits(dayOf(workout)));
  const present = new Set(kept.map((workout) => workout.id));
  const entered: Workout[] = [];
  for (const change of changes) {
    if (present.has(change.id)) continue;
    const base = workouts.find((w) => w.id === change.id) ?? pool.find((w) => w.id === change.id);
    if (!base || base.status === 'in_progress') continue;
    const moved = shiftWorkout(base, change.date, now);
    if (fits(dayOf(moved))) entered.push(moved);
  }
  return [...kept, ...entered].sort(bySeenDate);
}

export const dayWindow = (date: string) => (day: string) => day === date;
export const rangeWindow = (from: string, to: string) => (day: string) => day >= from && day <= to;

/** Calendário do mês: a contagem do dia velho passa para o novo. */
export function applyPendingToCalendar(
  data: WorkoutCalendarData,
  month: string,
  changes: PendingDateChange[] = pendingDateChanges(),
): WorkoutCalendarData {
  const moves = changes.filter((change) => change.previousDate);
  if (moves.length === 0 || !Array.isArray(data?.days)) return data;
  const counts = new Map(data.days.map((d) => [d.date, d.count]));
  for (const change of moves) {
    const oldDay = calendarDay(change.previousDate!);
    const newDay = calendarDay(change.date);
    if (oldDay === newDay) continue;
    if (monthKey(oldDay) === month && (counts.get(oldDay) ?? 0) > 0) counts.set(oldDay, counts.get(oldDay)! - 1);
    if (monthKey(newDay) === month) counts.set(newDay, (counts.get(newDay) ?? 0) + 1);
  }
  const days = [...counts.entries()].filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
  return { ...data, days };
}

/** Totais de semana e mês de `/workouts/stats`. */
export function applyPendingToStats(
  stats: WorkoutStats,
  changes: PendingDateChange[] = pendingDateChanges(),
  now: Date = new Date(),
): WorkoutStats {
  let next = stats;
  for (const change of changes) {
    if (!change.previousDate) continue;
    next = adjustStats(next, new Date(change.previousDate), change.date, now);
  }
  return next;
}

/** `/dashboard`: treinos da semana, totais, desempenho da semana e "última vez" do treino da vez. */
export function applyPendingToDashboard(
  data: DashboardData,
  changes: PendingDateChange[] = pendingDateChanges(),
  now: Date = new Date(),
  pool: Workout[] = poolSource(),
): DashboardData {
  if (changes.length === 0) return data;
  const next: DashboardData = { ...data };
  if (Array.isArray(data.weekly_workouts)) {
    const weekStart = startOfWeek(now).getTime();
    const weekEnd = weekStart + 7 * 24 * 3_600_000;
    const inWeek = (day: string) => {
      const at = new Date(`${day}T12:00:00`).getTime();
      return at >= weekStart && at < weekEnd;
    };
    next.weekly_workouts = applyPendingToWindow(data.weekly_workouts, inWeek, changes, now, pool);
  }
  const weekDelta = { v: 0 };
  for (const change of changes) {
    if (!change.previousDate) continue;
    const old = new Date(change.previousDate);
    const wasWeek = startOfWeek(old).getTime() === startOfWeek(now).getTime();
    const isWeek = startOfWeek(change.date).getTime() === startOfWeek(now).getTime();
    if (wasWeek !== isWeek) weekDelta.v += isWeek ? 1 : -1;
    if (data.next_workout && change.dayId !== undefined && data.next_workout.day_id === change.dayId) {
      next.next_workout = { ...(next.next_workout ?? data.next_workout), last_done_at: lastDone(next.next_workout?.last_done_at ?? data.next_workout.last_done_at, old, change.date) };
    }
  }
  if (data.workout_stats) next.workout_stats = applyPendingToStats(data.workout_stats, changes, now);
  if (data.weekly_performance && weekDelta.v !== 0) {
    const done = Math.max(0, data.weekly_performance.done_this_week + weekDelta.v);
    next.weekly_performance = { ...data.weekly_performance, done_this_week: done, remaining: Math.max(0, data.weekly_performance.target_per_week - done) };
  }
  return next;
}

/** `last_done_at` dos dias do plano. */
export function applyPendingToPlan<T extends Pick<TrainingPlan, 'days'>>(
  plan: T,
  changes: PendingDateChange[] = pendingDateChanges(),
): T {
  if (!plan?.days?.length) return plan;
  const moves = changes.filter((change) => change.previousDate && change.dayId !== undefined);
  if (moves.length === 0) return plan;
  let touched = false;
  const days = plan.days.map((day) => {
    let current = day.last_done_at;
    for (const change of moves) {
      if (day.id !== change.dayId) continue;
      const next = lastDone(current, new Date(change.previousDate!), change.date);
      if (next !== current) { current = next; touched = true; }
    }
    return current === day.last_done_at ? day : { ...day, last_done_at: current };
  });
  return touched ? { ...plan, days } : plan;
}
