// FINALIZAÇÃO AUTOMÁTICA de treino esquecido.
//
// A sessão em andamento guarda o início (`workout.started_at`, no slot próprio
// do store offline). Passando de 3× o tempo estimado sem ninguém finalizar, o
// app fecha o treino sozinho: marca as séries que faltam como feitas (reps ou
// tempo planejados e a última carga do exercício) e grava o fim como
// INÍCIO + estimativa — não a hora em que o app foi reaberto, que é justamente
// o que jogava o treino para o dia seguinte.
//
// Tudo local-first (`enqueueWrite`): funciona sem rede e sem mensagem. O
// `/complete` é idempotente (as séries que já foram enviadas com `client_set_id`
// contam; o servidor só completa o que falta).
//
// Quando roda (ver `startAutoFinish`): no boot, ao voltar do background
// (visibilitychange / appStateChange) e por timer enquanto a aba está oculta.

import { App as CapacitorApp } from '@capacitor/app';
import type { ActiveWorkout, CompleteWorkoutExercise, TrainingPlanExercise, Workout } from '../types';
import { enqueueWrite } from './offlineWrite';
import { applyChecklistLocally, findCachedPlanDay, readCachedActiveWorkout, storeLocalActiveWorkout } from './workoutSession';
import { clearWorkoutSessionState } from './workoutSessionState';
import { workoutsCache } from './local/repo/workouts';

export const AUTO_FINISH_FACTOR = 3;
const MIN_ESTIMATE_MINUTES = 30;
const EXECUTION_SECONDS_PER_SET = 45;
const NOTICE_KEY = 'mob_auto_finished_notice';
const CHECK_INTERVAL_MS = 60_000;

export interface AutoFinishNotice {
  workoutId: number;
  dayName: string;
  at: number;
}

/** Estimativa do tempo do treino, em minutos: o do plano, ou a soma das séries + descansos. */
export function estimateSessionMinutes(session: ActiveWorkout): number {
  const dayId = session.workout.training_plan_day_id;
  const planMinutes = dayId !== undefined ? findCachedPlanDay(dayId)?.plan.session_duration_minutes : undefined;
  if (planMinutes && planMinutes > 0) return planMinutes;
  let seconds = 0;
  for (const exercise of session.exercises) {
    const exec = exercise.tracking_type === 'time' ? exercise.duration_seconds ?? EXECUTION_SECONDS_PER_SET : EXECUTION_SECONDS_PER_SET;
    seconds += exercise.sets * (exec + (exercise.rest_seconds ?? 0));
  }
  return Math.max(MIN_ESTIMATE_MINUTES, Math.ceil(seconds / 60));
}

/** Última carga usada no exercício nesta sessão, ou a memorizada no plano. */
function weightFor(exercise: TrainingPlanExercise, session: ActiveWorkout): number {
  const done = (session.workout.sets ?? [])
    .filter((set) => set.training_plan_exercise_id === exercise.id && set.weight_kg > 0)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return done.length ? done[done.length - 1].weight_kg : exercise.last_weight_kg ?? 0;
}

let running = false;

/**
 * Finaliza a sessão aberta se ela passou de 3× o estimado. Devolve o aviso
 * gravado, ou null quando não havia nada a fazer.
 */
export function runAutoFinish(now: number = Date.now()): AutoFinishNotice | null {
  if (running) return null;
  const session = readCachedActiveWorkout();
  if (!session || session.workout.status !== 'in_progress') return null;
  const startedMs = new Date(session.workout.started_at ?? session.workout.date).getTime();
  if (Number.isNaN(startedMs)) return null;
  const estimateMs = estimateSessionMinutes(session) * 60_000;
  if (now - startedMs <= AUTO_FINISH_FACTOR * estimateMs) return null;

  running = true;
  try {
    const workoutId = session.workout.id;
    const entries: CompleteWorkoutExercise[] = session.exercises.filter((exercise) => exercise.id !== undefined).map((exercise) => ({
      training_plan_exercise_id: exercise.id as number,
      sets_done: exercise.sets,
      weight_kg: weightFor(exercise, session),
    }));

    // O fim: início + estimativa; nunca antes da última série registrada nem no futuro.
    const lastSetMs = Math.max(0, ...(session.workout.sets ?? []).map((set) => new Date(set.completed_at ?? set.created_at).getTime() || 0));
    const finishedMs = Math.min(now, Math.max(startedMs + estimateMs, lastSetMs));
    const finishedAt = new Date(finishedMs).toISOString();

    // As séries que faltam entram na cópia local (a mesma forma do checklist),
    // para o treino aparecer completo no histórico antes de a fila sair.
    const filled = applyChecklistLocally(workoutId, entries);

    enqueueWrite({
      method: 'POST',
      url: `/workouts/${workoutId}/complete`,
      body: { exercises: entries.filter((entry) => entry.sets_done > 0), finished_at: finishedAt },
      idempotent: true,
      trainingPlanDayId: session.workout.training_plan_day_id,
    });

    const closed: Workout = {
      ...(filled ?? session).workout,
      status: 'completed',
      finished_at: finishedAt,
      duration_minutes: Math.max(1, Math.min(600, Math.round((finishedMs - startedMs) / 60_000))),
    };
    void workoutsCache.put(closed);

    storeLocalActiveWorkout(null);
    clearWorkoutSessionState();

    const notice: AutoFinishNotice = { workoutId, dayName: session.day_name || session.workout.name, at: now };
    try {
      localStorage.setItem(NOTICE_KEY, JSON.stringify(notice));
    } catch { /* sem armazenamento: o treino foi fechado do mesmo jeito */ }
    return notice;
  } finally {
    running = false;
  }
}

/** O aviso ainda não visto, se houver. */
export function readAutoFinishNotice(): AutoFinishNotice | null {
  try {
    const raw = localStorage.getItem(NOTICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AutoFinishNotice>;
    return typeof parsed.workoutId === 'number' ? { workoutId: parsed.workoutId, dayName: String(parsed.dayName ?? ''), at: Number(parsed.at) || 0 } : null;
  } catch {
    return null;
  }
}

/** Marca o aviso como visto: aparece uma vez só. */
export function dismissAutoFinishNotice(): void {
  try {
    localStorage.removeItem(NOTICE_KEY);
  } catch { /* nada a fazer */ }
}

/**
 * Liga as verificações. Devolve a função que desliga. `onNotice` recebe o aviso
 * a cada finalização automática (o App abre o modal).
 */
export function startAutoFinish(onNotice: (notice: AutoFinishNotice) => void): () => void {
  const check = () => {
    const notice = runAutoFinish();
    if (notice) onNotice(notice);
  };
  check();
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', onVisible);
  const handle = CapacitorApp.addListener('appStateChange', ({ isActive }) => { if (isActive) check(); });
  // Com o app em segundo plano o timer segue (best effort): na volta, o check
  // acima já cobre o que o sistema tenha suspendido.
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    void Promise.resolve(handle).then((h) => h.remove()).catch(() => undefined);
    clearInterval(timer);
  };
}
