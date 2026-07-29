// Weekly progress and "which workout is due" computed on the device.
//
// The dashboard gets the same numbers from the server, but that endpoint is one
// request away from useless in a gym with no signal. Everything here is derived
// from what the offline cache already holds — the plan (with `last_done_at` per
// day), the recent workout history, and the sessions still sitting in the queue.
// The ordering rule mirrors the backend's `fillTrainingSummary` query on purpose:
// the two must not disagree about which day comes next.

import type { TrainingPlan, TrainingPlanDay, Workout } from '../types';
import type { LocalCompletedWorkout } from './workoutSession';

/**
 * Midnight of the Monday that starts the week containing `reference`. Mirrors
 * postgres' `date_trunc('week', ...)`, which is what the server counts against.
 */
export function startOfWeek(reference: Date = new Date()): Date {
  const date = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  // getDay() is 0 on Sunday, and Sunday closes the week rather than opening it.
  const offsetFromMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offsetFromMonday);
  return date;
}

/** Days left to train this week, counting today. Sunday is the last one. */
export function daysLeftInWeek(reference: Date = new Date()): number {
  const weekday = reference.getDay();
  return weekday === 0 ? 1 : 8 - weekday;
}

/**
 * `workout.date` and `day.last_done_at` both arrive as full timestamps (the
 * backend orders same-day sessions by the exact `MAX(w.date)` moment — see
 * `fillTrainingSummary` in dashboard.go — so the time of day is real
 * information, not noise). It is kept as-is here: two workouts logged on the
 * same calendar day must not tie on the client when the server does not,
 * or the plan screen and the dashboard end up pointing at different "treino
 * da vez" for the same week.
 *
 * A bare date (`2026-07-27`, no time component) has nothing to lose, so it is
 * parsed at local noon instead — that keeps a timezone behind UTC from
 * reading it as the day before, which would move a workout into the previous
 * week.
 */
function parseCalendarDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const hasTimeOfDay = /T\d{2}:\d{2}/.test(value);
  const parsed = new Date(hasTimeOfDay ? value : `${value.slice(0, 10)}T12:00:00`);
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : time;
}

export interface PlanDayProgress {
  day: TrainingPlanDay;
  /** Epoch ms of the last time this day was trained, null when never. */
  lastDoneAt: number | null;
  doneThisWeek: number;
  /** True for the one day the person should train next. */
  isNext: boolean;
  /** True when the last time came from the device, not from the server. */
  fromPendingQueue: boolean;
}

export interface PlanWeekProgress {
  target: number;
  done: number;
  remaining: number;
  daysLeftInWeek: number;
  onTrack: boolean;
  stillPossible: boolean;
  days: PlanDayProgress[];
  /** The day to start today, or null when the plan's days are not on this device. */
  next: TrainingPlanDay | null;
  /**
   * True when only the plan summary is cached (the list endpoint has no days), so
   * the week is known but no day can be highlighted.
   */
  daysUnknown: boolean;
  /** Sessions counted from the local queue rather than from the server. */
  pendingCount: number;
}

function dayNumberOf(day: TrainingPlanDay): number {
  return day.day_number ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Orders the days the way the backend does: the one trained longest ago first,
 * days never trained ahead of those, ties broken by registration order.
 */
function byDueness(a: PlanDayProgress, b: PlanDayProgress): number {
  if (a.lastDoneAt === null && b.lastDoneAt === null) return dayNumberOf(a.day) - dayNumberOf(b.day);
  if (a.lastDoneAt === null) return -1;
  if (b.lastDoneAt === null) return 1;
  if (a.lastDoneAt !== b.lastDoneAt) return a.lastDoneAt - b.lastDoneAt;
  return dayNumberOf(a.day) - dayNumberOf(b.day);
}

export interface PlanWeekProgressInput {
  plan: TrainingPlan;
  /** Recent completed workouts, as cached from `GET /workouts`. */
  workouts?: Workout[];
  /** Sessions finished offline whose writes are still queued. */
  pending?: LocalCompletedWorkout[];
  now?: Date;
}

export function computePlanWeekProgress(input: PlanWeekProgressInput): PlanWeekProgress {
  const { plan, workouts = [], pending = [], now = new Date() } = input;
  const weekStart = startOfWeek(now).getTime();

  // Every completed session, whichever side of the connection it came from. The
  // server's history is deduped against the queue by construction: a workout the
  // server already knows about is no longer pending.
  const sessions: { dayId: number | null; at: number }[] = [];
  for (const workout of workouts) {
    if (workout.status !== 'completed') continue;
    const at = parseCalendarDate(workout.date);
    if (at === null) continue;
    sessions.push({ dayId: workout.training_plan_day_id ?? null, at });
  }
  for (const local of pending) {
    sessions.push({ dayId: local.trainingPlanDayId, at: local.completedAt });
  }

  const pendingThisWeek = pending.filter((local) => local.completedAt >= weekStart).length;
  // Counted across every workout, plan day or free session — the same thing the
  // server's `weekly_performance` reports, so the two screens agree.
  const done = sessions.filter((session) => session.at >= weekStart).length;

  const days: PlanDayProgress[] = (plan.days ?? []).map((day) => {
    const serverLastDone = parseCalendarDate(day.last_done_at);
    const forThisDay = day.id === undefined ? [] : sessions.filter((session) => session.dayId === day.id);
    const localLastDone = forThisDay.reduce<number | null>(
      (latest, session) => (latest === null || session.at > latest ? session.at : latest),
      null,
    );
    // The cached plan snapshot may be older than the history and than anything
    // done offline, so the most recent of the three wins.
    const lastDoneAt = serverLastDone === null || (localLastDone !== null && localLastDone > serverLastDone)
      ? localLastDone ?? serverLastDone
      : serverLastDone;
    return {
      day,
      lastDoneAt,
      doneThisWeek: forThisDay.filter((session) => session.at >= weekStart).length,
      isNext: false,
      fromPendingQueue: pending.some((local) => local.trainingPlanDayId === day.id),
    };
  });

  const nextEntry = [...days].sort(byDueness)[0];
  if (nextEntry) {
    const marked = days.find((entry) => entry.day.id === nextEntry.day.id && entry.day.name === nextEntry.day.name);
    if (marked) marked.isNext = true;
  }

  const target = plan.days_per_week > 0 ? plan.days_per_week : 0;
  const remaining = Math.max(0, target - done);
  const left = daysLeftInWeek(now);

  return {
    target,
    done,
    remaining,
    daysLeftInWeek: left,
    onTrack: target > 0 && remaining === 0,
    stillPossible: remaining <= left,
    days,
    next: nextEntry?.day ?? null,
    daysUnknown: (plan.days ?? []).length === 0,
    pendingCount: pendingThisWeek,
  };
}
