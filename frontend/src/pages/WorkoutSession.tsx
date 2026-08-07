import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { workoutsApi } from '../api/workouts';
import { DEFAULT_SETTINGS, settingsApi } from '../api/settings';
import { WorkoutChecklist, type ChecklistState } from '../components/WorkoutChecklist';
import { WorkoutChat } from '../components/WorkoutChat';
import { ExerciseVideoPlayer } from '../components/ExerciseVideoPlayer';
import { getErrorMessage } from '../api/client';
import {
  dropQueuedMutations,
  isLocalId,
  isNetworkOnline,
  onWorkoutIdRemap,
  storeLocalActiveWorkout,
} from '../lib/offline';
import {
  clearWorkoutSessionState,
  loadWorkoutSessionState,
  saveWorkoutSessionState,
  type WorkoutSessionPhase,
} from '../lib/workoutSessionState';
import type { ActiveWorkout, TrainingPlanExercise, TrainingSettings, WorkoutSet } from '../types';

// The phase list lives next to the persistence helper: restoring one of these is
// what makes the timer survive the app being closed.
type Phase = WorkoutSessionPhase;

// A phase that ended while the app was closed still has to be reflected on
// screen, but buzzing for it is pointless — the alert only means something in
// the moment it fires. Anything older than this is treated as a late resume.
const STALE_ALERT_SECONDS = 5;

// One colour per phase so a glance mid-set tells you whether you are working or
// resting. Rest is blue against the orange brand — the two never read alike,
// including for the common red/green colour blindness.
const timerPanel = {
  countdown: { box: 'bg-amber-950/40 ring-1 ring-amber-800', label: 'text-amber-400', value: 'text-amber-300' },
  executing: { box: 'bg-primary-950/60 ring-1 ring-primary-700', label: 'text-primary-400', value: 'text-primary-200' },
  resting: { box: 'bg-sky-950/50 ring-1 ring-sky-800', label: 'text-sky-400', value: 'text-sky-300' },
  rest_done: { box: 'bg-sky-900/60 ring-2 ring-sky-500 animate-pulse', label: 'text-sky-300', value: 'text-sky-100' },
} as const;

/**
 * O alvo da série — repetições, ou tempo quando o exercício é por duração.
 *
 * Aparece em dois tamanhos porque muda de papel conforme a fase: durante o
 * esforço divide a linha com o cronômetro e é referência de canto de olho;
 * no descanso sobe sozinho acima do cronômetro grande, que é quando a pessoa
 * está de fato lendo quantas repetições vêm.
 */
function AlvoDaSerie({ exercise, grande = false }: { exercise: TrainingPlanExercise; grande?: boolean }) {
  const porTempo = exercise.tracking_type === 'time';
  const valor = porTempo ? formatClock(exercise.duration_seconds ?? 0) : String(exercise.reps);
  const rotulo = porTempo ? 'de execução' : 'repetições';
  return (
    <div className={`rounded-2xl bg-primary-950 ring-1 ring-primary-800 ${grande ? 'px-5 py-3' : 'px-3 py-3'}`}>
      <p className={`font-black tabular-nums text-primary-200 ${grande ? 'text-4xl' : 'text-3xl'}`}>{valor}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-400">{rotulo}</p>
    </div>
  );
}

/** O cronômetro compacto que divide a linha com o alvo, no preparo e na execução. */
function CronometroCompacto({ fase, valor }: { fase: 'countdown' | 'executing'; valor: string }) {
  const cores = timerPanel[fase];
  return (
    // `key` na fase para o painel remontar ao passar de "Prepare-se" para
    // "Executando": sem isso a cor e o rótulo trocariam secamente no lugar, que
    // é justamente a transição que a pessoa mais vê — uma por série.
    <div key={fase} className={`animate-scale-in rounded-2xl px-3 py-3 ${cores.box}`}>
      <p className={`text-3xl font-black tabular-nums ${cores.value}`}>{valor}</p>
      <p className={`mt-0.5 text-[11px] font-bold uppercase tracking-wide ${cores.label}`}>
        {fase === 'countdown' ? 'Prepare-se' : 'Executando'}
      </p>
    </div>
  );
}

function formatClock(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function parseWeight(text: string | undefined) {
  const value = Number((text ?? '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Orders series from oldest to newest. Ones recorded offline carry negative ids
 * and are always the most recent, the newest being the most negative — sorting
 * by raw id would put them first and make "voltar" undo the wrong series.
 */
function byOldestFirst(a: WorkoutSet, b: WorkoutSet) {
  if (isLocalId(a.id) !== isLocalId(b.id)) return isLocalId(a.id) ? 1 : -1;
  return isLocalId(a.id) ? b.id - a.id : a.id - b.id;
}

/** Matches the queued POST that created a series, so undoing it drops the request. */
function isQueuedSetFor(body: unknown, set: WorkoutSet) {
  if (typeof body !== 'object' || body === null) return false;
  const payload = body as { set_number?: unknown; training_plan_exercise_id?: unknown };
  return payload.set_number === set.set_number
    && payload.training_plan_exercise_id === set.training_plan_exercise_id;
}

function vibrate(pattern: number | number[], enabled: boolean) {
  if (!enabled) return;
  // Not available on desktop or iOS Safari; the visual cue carries it there.
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  }
}

function PostponeSheet({ exercises, remainingFor, currentId, onPick, onClose }: {
  exercises: TrainingPlanExercise[];
  remainingFor: (exercise: TrainingPlanExercise) => number;
  currentId?: number;
  onPick: (exerciseId: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-zinc-900 p-5" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-lg font-bold text-white">Escolher outro exercício</h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          O exercício atual continua pendente e volta a aparecer depois.
        </p>
        <div className="mt-4 space-y-2">
          {exercises.map((exercise) => (
            <button
              key={exercise.id}
              type="button"
              onClick={() => exercise.id && onPick(exercise.id)}
              className={`w-full rounded-2xl p-4 text-left ${exercise.id === currentId ? 'bg-primary-950 ring-1 ring-primary-700' : 'bg-zinc-950'}`}
            >
              <p className="font-semibold text-white">{exercise.exercise_name}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {remainingFor(exercise)} de {exercise.sets} séries restantes
                {exercise.id === currentId && ' · atual'}
              </p>
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-4 w-full py-3 text-sm text-zinc-500">
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function WorkoutSessionPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState<ActiveWorkout | null>(null);
  const [settings, setSettings] = useState<TrainingSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentExerciseId, setCurrentExerciseId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('countdown');
  // Phases are anchored to a timestamp instead of a counter, so a locked screen
  // or a throttled tab still shows the correct time when it comes back.
  const [phaseStart, setPhaseStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  // Kept as raw text so the field can be empty while typing. Holding a number
  // here forces a "0" that new digits get appended to ("30" typed over 0 => "030").
  const [weights, setWeights] = useState<Record<number, string>>({});
  const [showPostpone, setShowPostpone] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [finishSheet, setFinishSheet] = useState<ChecklistState | null>(null);
  // Set when the last series of an exercise lands, so the handover screen can
  // still show what was just finished after the current exercise moves on.
  const [finishedExerciseId, setFinishedExerciseId] = useState<number | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const transitionGuard = useRef('');
  // setIsBusy only takes effect on the next render, which is too late to stop a
  // second tap that lands in the same frame. A ref blocks it synchronously.
  const isRecording = useRef(false);

  const completedSets: WorkoutSet[] = useMemo(() => active?.workout.sets ?? [], [active]);

  const doneCountFor = useCallback(
    (exerciseId?: number) => completedSets.filter((set) => set.training_plan_exercise_id === exerciseId).length,
    [completedSets],
  );

  const exercises = active?.exercises ?? [];
  const pendingExercises = exercises.filter((exercise) => doneCountFor(exercise.id) < exercise.sets);
  // A manually picked exercise is only honoured while it still has series left,
  // otherwise the session would stay parked on a finished exercise.
  const selectedExercise = exercises.find((exercise) => exercise.id === currentExerciseId);
  const currentExercise: TrainingPlanExercise | undefined =
    selectedExercise && doneCountFor(selectedExercise.id) < selectedExercise.sets
      ? selectedExercise
      : pendingExercises[0];
  const currentSetNumber = currentExercise ? doneCountFor(currentExercise.id) + 1 : 1;
  const allDone = exercises.length > 0 && pendingExercises.length === 0;

  const startPhase = useCallback((next: Phase) => {
    setPhase(next);
    setPhaseStart(Date.now());
    setNow(Date.now());
  }, []);

  // Load the open session plus the user's timing preferences, then pick the
  // phase timer up wherever it was when the app was last closed.
  useEffect(() => {
    Promise.all([workoutsApi.active(), settingsApi.get().catch(() => DEFAULT_SETTINGS)])
      .then(([session, loadedSettings]) => {
        if (!session) {
          setError('Nenhum treino em andamento.');
          // No open workout means whatever is stored belongs to a session that
          // is already over.
          clearWorkoutSessionState();
          return;
        }
        setActive(session);
        setSettings(loadedSettings);
        // Starts blank when there is no previous weight, so the field is ready to type into.
        const defaultWeights = Object.fromEntries(
          session.exercises
            .filter((exercise) => exercise.id)
            .map((exercise) => [exercise.id as number, exercise.last_weight_kg ? String(exercise.last_weight_kg) : '']),
        );

        // Only state belonging to this workout id is honoured; the helper drops
        // anything else. The completed series are not restored from here — they
        // come from the server with the session above.
        const restored = loadWorkoutSessionState(session.workout.id);
        if (restored) {
          // The original phaseStart is kept instead of being reset to now:
          // `elapsed` is derived from it, so a series carries on from where it
          // stopped, and a rest that ran out while the app was closed comes back
          // already finished instead of counting down again.
          setPhase(restored.phase);
          setPhaseStart(restored.phaseStart);
          setNow(Date.now());
          setCurrentExerciseId(restored.currentExerciseId);
          setFinishedExerciseId(restored.finishedExerciseId);
          // What was typed by hand wins over the weight suggested by the server.
          setWeights({ ...defaultWeights, ...restored.weights });
          return;
        }

        setWeights(defaultWeights);
        startPhase(loadedSettings.countdown_seconds > 0 ? 'countdown' : 'executing');
      })
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  }, [startPhase]);

  // A session started offline runs on a negative id until the queued start
  // reaches the server. When that happens mid-workout, the id in memory has to
  // follow: the next series would otherwise be posted to `/workouts/-1/sets`
  // again, and the effect below would write the stale id back to localStorage.
  useEffect(() => onWorkoutIdRemap((localId, realId) => {
    setActive((current) => (
      current && current.workout.id === localId
        ? { ...current, workout: { ...current.workout, id: realId } }
        : current
    ));
  }), []);

  // Mirrors the phase state to localStorage on every change, so closing the app
  // — or the system killing it in the background — costs nothing.
  useEffect(() => {
    if (!active) return;
    saveWorkoutSessionState({
      workoutId: active.workout.id,
      phase,
      phaseStart,
      currentExerciseId,
      finishedExerciseId,
      weights,
      savedAt: Date.now(),
    });
  }, [active, phase, phaseStart, currentExerciseId, finishedExerciseId, weights]);

  // Single ticker drives every phase.
  useEffect(() => {
    if (phase === 'done' || phase === 'rest_done') return;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [phase]);

  const elapsed = Math.floor((now - phaseStart) / 1000);
  const restSeconds = currentExercise?.rest_seconds ?? 0;
  const plannedDuration = currentExercise?.duration_seconds ?? 0;
  const isTimed = currentExercise?.tracking_type === 'time';

  const refresh = useCallback(async () => {
    const session = await workoutsApi.active();
    if (session) setActive(session);
    return session;
  }, []);

  // Applies a change to the running session in memory and to the cached snapshot
  // of /workouts/active. Offline the server cannot confirm anything, so this is
  // what keeps the session moving — and what makes it survive a reload with no
  // connection, since the cache is where a restart reads the session from.
  const applySessionLocally = useCallback((sets: WorkoutSet[]) => {
    setActive((current) => {
      if (!current) return current;
      const patched: ActiveWorkout = { ...current, workout: { ...current.workout, sets } };
      storeLocalActiveWorkout(patched);
      return patched;
    });
  }, []);

  // The session is over: a stale snapshot would greet the next visit with a
  // workout that has already been closed.
  const forgetSessionLocally = useCallback(() => {
    clearWorkoutSessionState();
    storeLocalActiveWorkout(null);
  }, []);

  // Single place that decides what follows a series, so every path out of the
  // rest phase — timer expiry, "pular descanso", "continuar" — goes through the
  // exercise handover instead of skipping straight into the next exercise.
  const advanceAfterRest = useCallback(() => {
    if (finishedExerciseId !== null) {
      startPhase('exercise_done');
      return;
    }
    startPhase(settings.countdown_seconds > 0 ? 'countdown' : 'executing');
  }, [finishedExerciseId, settings.countdown_seconds, startPhase]);

  const recordSet = useCallback(async (secondsSpent: number) => {
    if (!active || !currentExercise) return;
    if (isRecording.current) return;
    // Never send a series past the planned count; the server rejects it anyway.
    if (currentSetNumber > currentExercise.sets) return;
    isRecording.current = true;
    setIsBusy(true);
    try {
      const recorded = await workoutsApi.completeSet(active.workout.id, {
        training_plan_exercise_id: currentExercise.id,
        exercise_name: currentExercise.exercise_name,
        set_number: currentSetNumber,
        reps: isTimed ? 1 : currentExercise.reps,
        weight_kg: currentExercise.id ? parseWeight(weights[currentExercise.id]) : 0,
        tracking_type: currentExercise.tracking_type,
        duration_seconds: secondsSpent > 0 ? secondsSpent : undefined,
      });
      // A negative id means the POST is sitting in the offline queue. Re-reading
      // the session would hand back a snapshot that predates this series and the
      // screen would ask for the same one again, so it is applied locally.
      if (isLocalId(recorded.id)) applySessionLocally([...completedSets, recorded]);
      else await refresh();
      const wasLastSet = currentSetNumber >= currentExercise.sets;
      if (wasLastSet) {
        // Straight to the handover. Staying in the plain rest phase would show
        // the next exercise's name while resting, since the finished one has
        // just dropped out of the pending list — the change would slip by
        // unannounced. The rest countdown runs on the handover screen instead.
        if (currentExercise.id) setFinishedExerciseId(currentExercise.id);
        startPhase('exercise_done');
      } else if (restSeconds > 0) {
        startPhase('resting');
      } else {
        vibrate(200, settings.vibration_enabled);
        startPhase(settings.countdown_seconds > 0 ? 'countdown' : 'executing');
      }
    } catch (requestError) {
      // A rejected extra series means the screen was behind — resync and move on.
      await refresh().catch(() => undefined);
      setError(getErrorMessage(requestError));
    } finally {
      isRecording.current = false;
      setIsBusy(false);
    }
  }, [active, currentExercise, currentSetNumber, isTimed, weights, refresh, restSeconds, startPhase, settings]);

  // Automatic transitions: end of the preparation countdown, end of a timed
  // execution, and end of the rest period.
  useEffect(() => {
    if (!currentExercise || isBusy) return;
    const key = `${phase}-${currentExercise.id}-${currentSetNumber}-${phaseStart}`;
    // True when the phase ended a while ago, i.e. the app is coming back from
    // being closed. The transition still happens, only the buzz is dropped.
    const isLateResume = (phaseSeconds: number) => elapsed - phaseSeconds > STALE_ALERT_SECONDS;

    if (phase === 'countdown' && elapsed >= settings.countdown_seconds) {
      if (transitionGuard.current === key) return;
      transitionGuard.current = key;
      startPhase('executing');
      return;
    }
    if (phase === 'executing' && isTimed && plannedDuration > 0 && elapsed >= plannedDuration) {
      if (transitionGuard.current === key) return;
      transitionGuard.current = key;
      // Only auto-record when the timer really ran out with the screen open. On
      // a late resume (phone died mid-plank, reopened hours later) we cannot
      // know the exercise was performed — recording it would invent work the
      // person never did, so the series is left for them to confirm.
      // Staying in `executing` keeps the "Concluir agora" button on screen, so
      // finishing the series stays one deliberate tap away.
      if (isLateResume(plannedDuration)) return;
      vibrate(200, settings.vibration_enabled);
      void recordSet(plannedDuration);
      return;
    }
    if (phase === 'resting' && elapsed >= restSeconds) {
      if (transitionGuard.current === key) return;
      transitionGuard.current = key;
      vibrate([300, 150, 300], settings.vibration_enabled && !isLateResume(restSeconds));
      // Changing exercise always waits for a tap — that handover is the whole
      // point of this screen, so auto-advance only applies between series.
      if (finishedExerciseId !== null || settings.auto_advance) {
        advanceAfterRest();
      } else {
        setPhase('rest_done');
      }
      return;
    }
    // Rest shown on the handover screen: buzz when it ends, but never advance —
    // moving to the next exercise stays a deliberate tap.
    if (phase === 'exercise_done' && finishedExerciseId !== null) {
      const handoverRest = exercises.find((exercise) => exercise.id === finishedExerciseId)?.rest_seconds ?? 0;
      if (handoverRest > 0 && elapsed >= handoverRest) {
        if (transitionGuard.current === key) return;
        transitionGuard.current = key;
        vibrate([300, 150, 300], settings.vibration_enabled && !isLateResume(handoverRest));
      }
    }
  }, [phase, elapsed, settings, isTimed, plannedDuration, restSeconds, currentExercise, currentSetNumber, phaseStart, isBusy, recordSet, startPhase, finishedExerciseId, advanceAfterRest, exercises]);

  // Once every exercise is complete the session moves to the summary.
  useEffect(() => {
    if (allDone && phase !== 'done') setPhase('done');
  }, [allDone, phase]);

  // Moving to a different exercise always restarts the preparation countdown.
  const goToExercise = (exerciseId: number) => {
    setCurrentExerciseId(exerciseId);
    setFinishedExerciseId(null);
    setShowPostpone(false);
    startPhase(settings.countdown_seconds > 0 ? 'countdown' : 'executing');
  };

  // "Voltar" undoes the most recent series so it can be redone.
  const goBack = async () => {
    if (!active || completedSets.length === 0) return;
    const last = [...completedSets].sort(byOldestFirst).pop();
    if (!last) return;
    setIsBusy(true);
    try {
      if (isLocalId(last.id)) {
        // The series never reached the server, so undoing it means dropping the
        // POST that is still queued — a DELETE would carry an id the server has
        // never seen.
        dropQueuedMutations((mutation) => (
          mutation.method === 'POST'
          && mutation.url === `/workouts/${active.workout.id}/sets`
          && isQueuedSetFor(mutation.body, last)
        ));
        applySessionLocally(completedSets.filter((set) => set.id !== last.id));
      } else {
        await workoutsApi.deleteSet(active.workout.id, last.id);
        if (isNetworkOnline()) await refresh();
        else applySessionLocally(completedSets.filter((set) => set.id !== last.id));
      }
      if (last.training_plan_exercise_id) setCurrentExerciseId(last.training_plan_exercise_id);
      setFinishedExerciseId(null);
      startPhase(settings.countdown_seconds > 0 ? 'countdown' : 'executing');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsBusy(false);
    }
  };

  // Pre-ticks whatever the session already recorded, so finishing early is a
  // confirmation rather than re-entering the whole workout.
  const openFinishSheet = () => {
    setFinishSheet(Object.fromEntries(
      exercises.filter((exercise) => exercise.id).map((exercise) => {
        const done = doneCountFor(exercise.id);
        const lastLogged = [...completedSets].reverse().find((set) => set.training_plan_exercise_id === exercise.id);
        const weight = lastLogged?.weight_kg || exercise.last_weight_kg || 0;
        return [exercise.id as number, { setsDone: done, weight: weight ? String(weight) : '' }];
      }),
    ));
  };

  const confirmFinishSheet = async () => {
    if (!active || !finishSheet) return;
    setIsBusy(true);
    try {
      await workoutsApi.complete(active.workout.id, {
        exercises: Object.entries(finishSheet)
          .filter(([, entry]) => entry.setsDone > 0)
          .map(([id, entry]) => ({
            training_plan_exercise_id: Number(id),
            sets_done: entry.setsDone,
            weight_kg: Number((entry.weight || '0').replace(',', '.')) || 0,
          })),
      });
      forgetSessionLocally();
      navigate(active.plan_id ? `/training-plans/${active.plan_id}` : '/workouts');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setIsBusy(false);
    }
  };

  const finish = async () => {
    if (!active) return;
    setIsBusy(true);
    try {
      await workoutsApi.finish(active.workout.id);
      forgetSessionLocally();
      navigate(active.plan_id ? `/training-plans/${active.plan_id}` : '/workouts');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setIsBusy(false);
    }
  };

  const cancel = async () => {
    if (!active) return;
    if (!window.confirm('Descartar este treino? As séries já registradas serão perdidas.')) return;
    setIsBusy(true);
    try {
      await workoutsApi.cancel(active.workout.id);
      forgetSessionLocally();
      navigate(active.plan_id ? `/training-plans/${active.plan_id}` : '/workouts');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setIsBusy(false);
    }
  };

  if (isLoading) return <div className="py-20 text-center text-zinc-500">Carregando treino...</div>;
  if (error && !active) {
    return (
      <>
        <Header title="Treino" showBack />
        <div className="space-y-4 px-4 py-10 text-center">
          <p className="text-zinc-400">{error}</p>
          <Button fullWidth onClick={() => navigate('/workouts')}>Voltar para treinos</Button>
        </div>
      </>
    );
  }
  if (!active) return null;

  const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  const doneSets = completedSets.length;

  // The chat sits in the header slot on purpose: it is reachable at any point of
  // the session — usually while resting — without taking space next to
  // "Próximo", which is the button being hit with one hand mid-set.
  const chatButton = (
    <button
      type="button"
      onClick={() => setShowChat(true)}
      aria-label="Tirar dúvida sobre o treino"
      className="rounded-full bg-zinc-800 px-3.5 py-2 text-xs font-semibold text-primary-300"
    >
      Dúvidas
    </button>
  );

  // Rendered by the execution screen and by the handover, so a question is never
  // more than one tap away while the session is running.
  const chatNode = showChat && (
    <WorkoutChat
      workoutId={active.workout.id}
      onClose={() => setShowChat(false)}
      exerciseName={currentExercise?.exercise_name}
    />
  );

  // Rendered by both the main screen and the handover, so finishing early is
  // always one tap away wherever the session happens to be.
  const finishSheetNode = finishSheet && (
    <div className="fixed inset-0 z-[110] flex items-end bg-black/85 backdrop-blur-sm" onClick={() => setFinishSheet(null)}>
      <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-zinc-900 p-5" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-lg font-bold text-white">Finalizar treino agora</h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Já vem marcado o que você concluiu. Ajuste o que fez fora do acompanhamento e finalize.
        </p>
        <div className="mt-4">
          <WorkoutChecklist
            exercises={exercises}
            state={finishSheet}
            onChange={(exerciseId, entry) => setFinishSheet((current) => ({ ...(current ?? {}), [exerciseId]: entry }))}
            lockedFor={(exerciseId) => doneCountFor(exerciseId)}
          />
        </div>
        <div className="mt-5 space-y-2">
          <Button fullWidth size="lg" onClick={confirmFinishSheet} isLoading={isBusy}>Finalizar treino</Button>
          <button type="button" onClick={() => setFinishSheet(null)} className="w-full py-3 text-sm text-zinc-500">
            Voltar ao treino
          </button>
        </div>
      </div>
    </div>
  );

  if (phase === 'done') {
    const volume = completedSets.reduce((sum, set) => sum + set.weight_kg * set.reps, 0);
    return (
      <>
        <Header title="Treino concluído" />
        <div className="space-y-5 px-4 py-6 pb-24">
          <Card className="text-center">
            <p className="text-5xl">🎉</p>
            <h2 className="mt-3 text-xl font-black text-white">{active.day_name || active.workout.name}</h2>
            <p className="mt-1 text-sm text-zinc-500">{doneSets} séries concluídas</p>
            {volume > 0 && <p className="mt-1 text-sm text-primary-300">{volume.toLocaleString('pt-BR')} kg de volume total</p>}
          </Card>
          <div className="space-y-2">
            {exercises.map((exercise) => (
              <Card key={exercise.id} className="flex items-center justify-between py-3">
                <span className="text-sm text-white">{exercise.exercise_name}</span>
                <span className="text-xs text-zinc-500">{doneCountFor(exercise.id)}/{exercise.sets}</span>
              </Card>
            ))}
          </div>
          {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
          <Button fullWidth size="lg" onClick={finish} isLoading={isBusy}>Finalizar treino</Button>
        </div>
      </>
    );
  }

  if (!currentExercise) return null;

  // Handover screen: what was just finished, then what comes next, behind a tap
  // so the change of exercise is never something you discover mid-set.
  if (phase === 'exercise_done') {
    const finished = exercises.find((exercise) => exercise.id === finishedExerciseId);
    const finishedSets = completedSets.filter((set) => set.training_plan_exercise_id === finishedExerciseId);
    const finishedVolume = finishedSets.reduce((sum, set) => sum + set.weight_kg * set.reps, 0);
    // The rest that belongs to the exercise just finished runs here, so the
    // handover is visible from the first second instead of after the countdown.
    const handoverRest = finished?.rest_seconds ?? 0;
    const handoverRestLeft = handoverRest - elapsed;
    const startNext = () => {
      setFinishedExerciseId(null);
      setCurrentExerciseId(currentExercise.id ?? null);
      startPhase(settings.countdown_seconds > 0 ? 'countdown' : 'executing');
    };

    return (
      <>
        <Header title={active.day_name || active.workout.name} rightAction={chatButton} />
        <div className="space-y-4 px-4 py-5 pb-32">
          {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }} />
          </div>

          {finished && (
            <Card className="border-emerald-900 bg-emerald-950/20">
              <div className="flex items-center gap-2">
                <span className="text-lg">✓</span>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">Exercício concluído</p>
              </div>
              <h2 className="mt-1 text-xl font-black leading-tight text-white">{finished.exercise_name}</h2>
              <div className="mt-3 space-y-1.5">
                {finishedSets.map((set, index) => (
                  <div key={set.id} className="flex items-center justify-between rounded-lg bg-black/30 px-3 py-2 text-sm">
                    <span className="text-zinc-500">{index + 1}ª série</span>
                    <span className="font-medium text-zinc-200">
                      {set.tracking_type === 'time'
                        ? formatClock(set.duration_seconds ?? 0)
                        : `${set.reps} reps${set.weight_kg > 0 ? ` · ${set.weight_kg} kg` : ''}`}
                    </span>
                  </div>
                ))}
              </div>
              {finishedVolume > 0 && (
                <p className="mt-3 text-xs text-emerald-300">Volume: {finishedVolume.toLocaleString('pt-BR')} kg</p>
              )}
            </Card>
          )}

          {handoverRest > 0 && (
            <div className={`rounded-2xl px-4 py-4 text-center ${handoverRestLeft > 0 ? timerPanel.resting.box : timerPanel.rest_done.box}`}>
              <p className={`text-sm font-bold uppercase tracking-widest ${timerPanel.resting.label}`}>Descanso</p>
              <p className={`mt-1 text-5xl font-black tabular-nums ${handoverRestLeft > 0 ? timerPanel.resting.value : timerPanel.rest_done.value}`}>
                {formatClock(Math.max(0, handoverRestLeft))}
              </p>
              {handoverRestLeft <= 0 && <p className="mt-1 text-sm font-semibold text-sky-200">Pronto para o próximo exercício</p>}
            </div>
          )}

          <div className="flex items-center gap-3 px-1">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-600">A seguir</span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>

          <Card className="border-primary-800 bg-primary-950/40 text-center">
            <p className="text-xs uppercase tracking-wide text-primary-400">
              Exercício {exercises.length - pendingExercises.length + 1} de {exercises.length}
            </p>
            <h2 className="mt-1 text-2xl font-black leading-tight text-white">{currentExercise.exercise_name}</h2>
            {/* Aqui é onde o vídeo serve para alguma coisa: a pessoa está
                prestes a executar e ainda dá tempo de conferir o movimento.
                Não renderiza nada quando não há vídeo. */}
            <ExerciseVideoPlayer video={currentExercise.video} className="mt-3 aspect-square" />
            <div className="mt-3 inline-flex items-baseline gap-2 rounded-2xl bg-primary-950 px-5 py-2.5 ring-1 ring-primary-800">
              {currentExercise.tracking_type === 'time' ? (
                <>
                  <span className="text-3xl font-black tabular-nums text-primary-200">{formatClock(currentExercise.duration_seconds ?? 0)}</span>
                  <span className="text-sm font-semibold text-primary-400">de execução</span>
                </>
              ) : (
                <>
                  <span className="text-4xl font-black tabular-nums text-primary-200">{currentExercise.reps}</span>
                  <span className="text-sm font-semibold uppercase tracking-wide text-primary-400">repetições</span>
                </>
              )}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
              <span className="rounded-lg bg-black/40 px-2 py-1 text-zinc-300">{currentExercise.sets} séries</span>
              {currentExercise.rest_seconds > 0 && (
                <span className="rounded-lg bg-black/40 px-2 py-1 text-zinc-400">{currentExercise.rest_seconds}s descanso</span>
              )}
              {currentExercise.last_weight_kg ? (
                <span className="rounded-lg bg-black/40 px-2 py-1 text-zinc-300">última vez: {currentExercise.last_weight_kg} kg</span>
              ) : null}
            </div>
            {currentExercise.notes && (
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">{currentExercise.notes}</p>
            )}
          </Card>

          <div className="space-y-2">
            <Button fullWidth size="lg" onClick={startNext}>Iniciar {currentExercise.exercise_name}</Button>
            <button
              type="button"
              onClick={() => setShowPostpone(true)}
              disabled={pendingExercises.length < 2}
              className="w-full rounded-2xl bg-zinc-800 py-3.5 text-sm font-semibold text-zinc-300 disabled:opacity-40"
            >
              Escolher outro exercício
            </button>
            <button
              type="button"
              onClick={goBack}
              disabled={isBusy || completedSets.length === 0}
              className="w-full py-3 text-xs text-zinc-500 disabled:opacity-40"
            >
              ← Refazer a última série
            </button>
            <button type="button" onClick={openFinishSheet} className="w-full py-2 text-xs font-semibold text-primary-400">
              Finalizar treino agora
            </button>
          </div>
        </div>

        {showPostpone && (
          <PostponeSheet
            exercises={pendingExercises}
            remainingFor={(exercise) => exercise.sets - doneCountFor(exercise.id)}
            onPick={goToExercise}
            onClose={() => setShowPostpone(false)}
          />
        )}
        {finishSheetNode}
        {chatNode}
      </>
    );
  }

  const weightText = currentExercise.id ? weights[currentExercise.id] ?? '' : '';
  const setWeightText = (value: string) => {
    if (currentExercise.id) setWeights((current) => ({ ...current, [currentExercise.id as number]: value }));
  };
  const stepWeight = (delta: number) => {
    const next = Math.max(0, parseWeight(weightText) + delta);
    setWeightText(next ? String(Number(next.toFixed(2))) : '');
  };
  const countdownLeft = settings.countdown_seconds - elapsed;
  const executionLeft = plannedDuration - elapsed;
  const restLeft = restSeconds - elapsed;
  const emDescanso = phase === 'resting' || phase === 'rest_done';

  return (
    <>
      {/* Altura fixa de viewport, em coluna, com os botões ancorados no rodapé.
          Antes a página crescia com o conteúdo e o botão de avançar caía abaixo
          da dobra — numa tela que a pessoa usa de pé, no meio da série, com o
          celular apoiado. Aqui só o miolo rola, se precisar; a ação principal
          está sempre à mão.

          `dvh` e não `vh` porque no Android a barra de endereço do WebView
          entra e sai, e `vh` congela na altura maior — o rodapé ficaria fora da
          tela justamente quando a barra aparece. */}
      <div className="flex h-[100dvh] flex-col">
        <Header title={active.day_name || active.workout.name} rightAction={chatButton} />

        <div className="shrink-0 px-4 pt-3">
          {error && <div className="mb-3 rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{doneSets} de {totalSets} séries</span>
            <span>{pendingExercises.length} exercício{pendingExercises.length === 1 ? '' : 's'} restante{pendingExercises.length === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }} />
          </div>
        </div>

        {/* O miolo. `min-h-0` é o que permite ele encolher dentro do flex — sem
            isso o conteúdo empurra a coluna e o rodapé sai da tela de novo. */}
        <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 text-center">
          <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-primary-400">
            Série {currentSetNumber} de {currentExercise.sets}
          </p>
          <h2 className="shrink-0 text-xl font-black leading-tight text-white">{currentExercise.exercise_name}</h2>

          {/* Duas leituras da mesma tela, conforme o que a pessoa está fazendo.
              Durante o esforço o que importa é ver o movimento, então o vídeo
              fica com toda a folga e cronômetro e alvo dividem uma linha acima.
              No descanso não há movimento para conferir: o vídeo sai e o
              cronômetro assume, porque aí ele é a única coisa que interessa. */}
          {emDescanso ? (
            <div key="descanso" className="flex min-h-0 flex-1 animate-scale-in flex-col justify-center gap-3">
              <div className="flex shrink-0 justify-center">
                <AlvoDaSerie exercise={currentExercise} grande />
              </div>
              {/* Maior que na fase de esforço: aqui o descanso é a única coisa
                  acontecendo, e o espaço que o vídeo deixou vago é dele. Deixar
                  o painel pequeno abriria um vazio no meio da tela. */}
              <div className={`shrink-0 rounded-2xl px-4 py-8 ${phase === 'rest_done' ? timerPanel.rest_done.box : timerPanel.resting.box}`}>
                <p className={`text-xs font-bold uppercase tracking-widest ${timerPanel.resting.label}`}>Descanso</p>
                <p className={`mt-1 text-7xl font-black tabular-nums ${phase === 'rest_done' ? timerPanel.rest_done.value : timerPanel.resting.value}`}>
                  {phase === 'rest_done' ? '0:00' : formatClock(restLeft)}
                </p>
                {phase === 'rest_done' && <p className="mt-1 text-sm font-semibold text-sky-200">Pronto para a próxima série</p>}
              </div>
            </div>
          ) : (
            // `justify-center` só faz efeito quando não há vídeo — com ele, o
            // player já consome a folga. Sem, centra o cronômetro em vez de
            // deixá-lo grudado no topo com um vazio embaixo.
            <div key="esforco" className="mt-2 flex min-h-0 flex-1 animate-fade-in flex-col justify-center gap-2">
              <div className="grid shrink-0 grid-cols-2 gap-2">
                <CronometroCompacto
                  fase={phase === 'countdown' ? 'countdown' : 'executing'}
                  valor={
                    phase === 'countdown'
                      ? String(Math.max(0, countdownLeft))
                      : isTimed && plannedDuration > 0
                        ? formatClock(executionLeft)
                        : formatClock(elapsed)
                  }
                />
                <AlvoDaSerie exercise={currentExercise} />
              </div>
              {/* Absorve toda a folga que sobrar, em vez de ter altura própria:
                  é o único elemento aqui que pode encolher sem perder função,
                  então é ele que se ajusta ao aparelho.

                  `h-full w-auto` em vez de largura cheia: o vídeo é quadrado, e
                  esticá-lo na largura deixava duas faixas cinza nas laterais.
                  Assim o elemento tem exatamente o tamanho da imagem. */}
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <ExerciseVideoPlayer video={currentExercise.video} className="h-full w-auto object-contain" />
              </div>
              {currentExercise.notes && (
                <p className="line-clamp-2 shrink-0 text-[11px] leading-snug text-zinc-500">{currentExercise.notes}</p>
              )}
            </div>
          )}

          {!isTimed && (
            <div className="mt-2 flex shrink-0 items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => stepWeight(-2.5)}
                className="h-10 w-10 shrink-0 rounded-xl bg-zinc-800 text-xl font-bold text-white"
              >
                −
              </button>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.5}
                // O peso da última vez vira o placeholder: informa a mesma coisa
                // que a linha "última vez" informava, sem gastar uma linha.
                placeholder={currentExercise.last_weight_kg ? String(currentExercise.last_weight_kg) : '0'}
                value={weightText}
                // Selecting on focus makes the first digit replace the old value
                // instead of being appended to it.
                onFocus={(event) => event.target.select()}
                onChange={(event) => setWeightText(event.target.value)}
                className="w-20 rounded-xl border border-zinc-700 bg-zinc-800 px-2 py-2 text-center text-lg font-bold text-white placeholder-zinc-600 focus:border-primary-500 focus:outline-none"
              />
              <span className="shrink-0 text-xs text-zinc-500">kg</span>
              <button
                type="button"
                onClick={() => stepWeight(2.5)}
                className="h-10 w-10 shrink-0 rounded-xl bg-zinc-800 text-xl font-bold text-white"
              >
                +
              </button>
            </div>
          )}
        </div>

        {/* Rodapé ancorado. `pb-24` livra a barra de navegação, que é fixa e
            flutua por cima de tudo. */}
        <div className="shrink-0 space-y-2 px-4 pb-24 pt-3">
          {phase === 'executing' && !isTimed && (
            <Button fullWidth size="lg" onClick={() => recordSet(elapsed)} isLoading={isBusy}>Próximo</Button>
          )}
          {phase === 'executing' && isTimed && (
            <Button fullWidth size="lg" onClick={() => recordSet(elapsed)} isLoading={isBusy}>Concluir agora</Button>
          )}
          {phase === 'countdown' && (
            <Button fullWidth size="lg" onClick={() => startPhase('executing')}>Começar agora</Button>
          )}
          {phase === 'resting' && (
            <Button fullWidth size="lg" onClick={advanceAfterRest}>
              Pular descanso
            </Button>
          )}
          {phase === 'rest_done' && (
            <Button fullWidth size="lg" onClick={advanceAfterRest}>
              Continuar
            </Button>
          )}

          {/* As quatro ações secundárias em duas linhas rasas. Finalizar e
              descartar viraram texto: são saídas, não o caminho normal, e
              ocupavam dois botões inteiros logo abaixo do que se aperta a cada
              série. */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={isBusy || completedSets.length === 0}
              className="rounded-xl bg-zinc-800 py-2.5 text-sm font-semibold text-zinc-300 disabled:opacity-40"
            >
              ← Voltar série
            </button>
            <button
              type="button"
              onClick={() => setShowPostpone(true)}
              disabled={pendingExercises.length < 2}
              className="rounded-xl bg-zinc-800 py-2.5 text-sm font-semibold text-zinc-300 disabled:opacity-40"
            >
              Adiar exercício
            </button>
          </div>
          <div className="flex items-center justify-between px-1">
            <button type="button" onClick={openFinishSheet} className="py-1 text-xs font-semibold text-primary-300">
              Finalizar treino agora
            </button>
            <button type="button" onClick={cancel} className="py-1 text-xs text-red-400">Descartar</button>
          </div>
        </div>
      </div>

      {showPostpone && (
        <PostponeSheet
          exercises={pendingExercises}
          remainingFor={(exercise) => exercise.sets - doneCountFor(exercise.id)}
          currentId={currentExercise.id}
          onPick={goToExercise}
          onClose={() => setShowPostpone(false)}
        />
      )}
      {finishSheetNode}
      {chatNode}
    </>
  );
}
