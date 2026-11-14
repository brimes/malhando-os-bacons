import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Ring, Bar } from '../components/Ring';
import { Sparks } from '../components/Sparks';
import { CountUp } from '../components/CountUp';
import { workoutsApi } from '../api/workouts';
import { DEFAULT_SETTINGS, settingsApi } from '../api/settings';
import { WorkoutChecklist, type ChecklistState } from '../components/WorkoutChecklist';
import { WorkoutChat } from '../components/WorkoutChat';
import { ExerciseVideoPlayer } from '../components/ExerciseVideoPlayer';
import { ExerciseIllustration } from '../components/ExerciseIllustration';
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

// Cada fase tem a sua cor (MASTER, "Fases do treino guiado"): ela tinge o selo do
// cronômetro, a série atual e o botão principal. Prepare-se é amarelo, esforço é
// laranja, descanso é teal — nunca parecem iguais, nem para daltonismo.
const phaseTone = {
  countdown: { text: 'text-sun', soft: 'bg-sun-soft', solid: 'bg-sun text-on-sun', label: 'Prepare-se' },
  executing: { text: 'text-brand-fg', soft: 'bg-brand-soft', solid: 'bg-brand text-white', label: 'Executando' },
  resting: { text: 'text-teal', soft: 'bg-teal-soft', solid: 'bg-teal text-on-teal', label: 'Descanso' },
  rest_done: { text: 'text-teal', soft: 'bg-teal-soft', solid: 'bg-teal text-on-teal', label: 'Descanso' },
} as const;

const EYEBROW = 'text-[12px] font-bold uppercase tracking-[0.06em] leading-[1.2]';

/** Botão principal da fase: 58 px, na cor dela. `pulse` é o pulso duplo do fim do descanso. */
function PhaseButton({ fase, onClick, disabled, pulse, children }: {
  fase: keyof typeof phaseTone;
  onClick: () => void;
  disabled?: boolean;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`press min-h-[58px] w-full rounded-md px-6 text-[17px] font-bold leading-tight disabled:cursor-not-allowed disabled:opacity-[.45] ${phaseTone[fase].solid} ${pulse ? 'pulse-double' : ''}`}
    >
      {children}
    </button>
  );
}

/** Ação secundária em linha: 48 px (ou 44 px quando discreta), sem preenchimento forte. */
const ACAO_SECUNDARIA = 'press min-h-[48px] rounded-md bg-surface-2 px-3 text-[15px] font-semibold text-fg disabled:cursor-not-allowed disabled:opacity-[.45]';
const ACAO_DISCRETA = 'press min-h-[44px] rounded-md px-1 text-[15px] font-semibold';
/**
 * Ação do rodapé do treino: botão de verdade (48 px, fundo `surface` com sombra, que é o que separa de um fundo que já é `surface-2`), ícone
 * acima do rótulo. `[overflow-wrap:normal]` + `whitespace-nowrap` porque o
 * `overflow-wrap:anywhere` global quebrava "Descartar" em "Descartar" + "r".
 * Cabe em 320 px: quatro colunas de ~64 px para um rótulo de 12 px.
 */
const ACAO_RODAPE = 'press flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md bg-surface px-1 text-[12px] font-semibold leading-none whitespace-nowrap shadow-card [overflow-wrap:normal] disabled:cursor-not-allowed disabled:opacity-[.45]';
const ICONE_RODAPE = { className: 'h-[18px] w-[18px] shrink-0', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

/**
 * O alvo da série — repetições, ou tempo quando o exercício é por duração.
 * Cartão sem borda, valor em display condensado.
 */
function AlvoDaSerie({ exercise }: { exercise: TrainingPlanExercise }) {
  const porTempo = exercise.tracking_type === 'time';
  const valor = porTempo ? formatClock(exercise.duration_seconds ?? 0) : String(exercise.reps);
  const rotulo = porTempo ? 'de execução' : 'repetições';
  return (
    <div className="flex h-[68px] [@media(max-height:600px)]:h-14 min-w-0 flex-col items-center justify-center rounded-lg bg-surface px-3 shadow-card">
      <p className="num text-[34px] [@media(max-height:600px)]:text-[28px] leading-none text-fg">{valor}</p>
      <p className={`mt-1 text-muted ${EYEBROW}`}>{rotulo}</p>
    </div>
  );
}

/**
 * O selo do cronômetro no preparo e na execução. Na contagem do preparo o número
 * é grande e pulsa a cada segundo: `key` no segundo remonta o elemento e reinicia
 * a animação, então o pulso acompanha o relógio em vez de correr solto.
 */
function SeloDoCronometro({ fase, valor }: { fase: 'countdown' | 'executing'; valor: string }) {
  const tom = phaseTone[fase];
  return (
    // `key` na fase para o selo remontar ao passar de "Prepare-se" para
    // "Executando": a cor e o rótulo entram com fade em vez de trocar secos.
    <div key={fase} className={`fade-in-mob flex h-[68px] [@media(max-height:600px)]:h-14 min-w-0 flex-col items-center justify-center rounded-lg px-3 ${tom.soft}`}>
      {fase === 'countdown' ? (
        <p key={valor} className={`pulse-count num text-[40px] [@media(max-height:600px)]:text-[32px] leading-none ${tom.text}`}>{valor}</p>
      ) : (
        <p className={`num text-[34px] [@media(max-height:600px)]:text-[28px] leading-none ${tom.text}`}>{valor}</p>
      )}
      <p className={`mt-1 ${tom.text} ${EYEBROW}`}>{tom.label}</p>
    </div>
  );
}

/**
 * Faixa compacta de séries: concluídas em `ok`, a atual na cor da fase, as
 * futuras apagadas. Só apresentação — o número vem da lógica da sessão.
 */
function FaixaDeSeries({ total, feitas, fase }: { total: number; feitas: number; fase: keyof typeof phaseTone }) {
  return (
    <ol className="flex shrink-0 flex-wrap justify-center gap-1.5" aria-label={`${feitas} de ${total} séries concluídas`}>
      {Array.from({ length: total }, (_, index) => {
        const numero = index + 1;
        const concluida = numero <= feitas;
        const atual = numero === feitas + 1;
        const cor = concluida
          ? 'bg-ok-soft text-ok'
          : atual
            ? phaseTone[fase].solid
            : 'bg-surface-2 text-dim';
        return (
          <li
            key={numero}
            aria-current={atual ? 'step' : undefined}
            className={`num flex h-8 min-w-[36px] items-center justify-center rounded-sm px-2 text-[18px] leading-none transition-colors duration-press ease-mob ${cor}`}
          >
            {numero}
          </li>
        );
      })}
    </ol>
  );
}

/** Stepper de carga: −/+ de 56 px, valor em num-lg, passo de 2,5 kg. */
function StepperDeCarga({ value, placeholder, onChange, onStep }: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onStep: (delta: number) => void;
}) {
  const botao = 'press num flex h-14 w-14 [@media(max-height:600px)]:h-12 [@media(max-height:600px)]:w-12 shrink-0 items-center justify-center rounded-md bg-surface text-[28px] leading-none text-fg shadow-card';
  return (
    <div className="shrink-0">
      <p className={`mb-1 text-center text-muted ${EYEBROW} [@media(max-height:700px)]:sr-only`}>Carga (kg)</p>
      <div className="flex items-center justify-center gap-3">
        <button type="button" onClick={() => onStep(-2.5)} aria-label="Diminuir 2,5 kg" className={botao}>−</button>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.5}
          aria-label="Carga em quilos"
          // O peso da última vez vira o placeholder: informa a mesma coisa
          // que a linha "última vez" informava, sem gastar uma linha.
          placeholder={placeholder}
          value={value}
          // Selecting on focus makes the first digit replace the old value
          // instead of being appended to it.
          onFocus={(event) => event.target.select()}
          onChange={(event) => onChange(event.target.value)}
          className="input-num min-w-0 flex-1 !bg-surface text-center shadow-card [@media(max-height:600px)]:!h-12 [@media(max-height:600px)]:!min-h-0"
        />
        <button type="button" onClick={() => onStep(2.5)} aria-label="Aumentar 2,5 kg" className={botao}>+</button>
      </div>
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
    <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="sheet-in max-h-[80vh] w-full overflow-y-auto rounded-t-xl bg-surface p-5 shadow-sheet pb-safe"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Escolher outro exercício"
      >
        <h3 className="num text-[28px] leading-[1.05] text-fg">Escolher outro exercício</h3>
        <p className="mt-1.5 text-[15px] leading-[1.45] text-muted">
          O exercício atual continua pendente e volta a aparecer depois.
        </p>
        <div className="mt-4 space-y-2">
          {exercises.map((exercise) => (
            <button
              key={exercise.id}
              type="button"
              onClick={() => exercise.id && onPick(exercise.id)}
              className={`press w-full rounded-md p-4 text-left ${exercise.id === currentId ? 'bg-brand-soft' : 'bg-surface-2'}`}
            >
              <p className="break-anywhere text-[16px] font-semibold leading-snug text-fg">{exercise.exercise_name}</p>
              <p className="mt-1 text-[15px] leading-[1.45] text-muted">
                {remainingFor(exercise)} de {exercise.sets} séries restantes
                {exercise.id === currentId && ' · atual'}
                {exercise.substituted_from && ' · trocado hoje'}
              </p>
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="press mt-3 min-h-[48px] w-full rounded-md text-[16px] font-semibold text-muted">
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Tela com no máximo `altura` px de altura (celular pequeno ou com barras do sistema). */
function useAlturaAte(altura: number): boolean {
  const query = `(max-height: ${altura}px)`;
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}

export function WorkoutSessionPage() {
  const navigate = useNavigate();
  // Tela baixa cede espaço à mídia; muito baixa (iPhone SE, 320×568) compacta também o resto.
  const telaBaixa = useAlturaAte(700);
  const telaMuitoBaixa = useAlturaAte(600);
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

  // Faíscas (só apresentação): disparam quando uma série nova aparece no
  // histórico — vale para o toque e para o fim automático de um exercício por
  // tempo — e se desmontam sozinhas em 500 ms, sem segurar o próximo toque.
  // O primeiro valor visto (carga da sessão) não conta como conclusão.
  const [sparking, setSparking] = useState(false);
  const seenSets = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const count = (active.workout.sets ?? []).length;
    const previous = seenSets.current;
    seenSets.current = count;
    if (previous === null || count <= previous) return;
    setSparking(true);
    const id = window.setTimeout(() => setSparking(false), 500);
    return () => window.clearTimeout(id);
  }, [active]);

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

  if (isLoading) return <div className="py-20 text-center text-[16px] text-muted">Carregando treino...</div>;
  if (error && !active) {
    return (
      <>
        <Header title="Treino" showBack />
        <div className="space-y-4 px-5 py-10 text-center">
          <p className="text-[16px] text-muted">{error}</p>
          <Button fullWidth size="lg" onClick={() => navigate('/workouts')}>Voltar para treinos</Button>
        </div>
      </>
    );
  }
  if (!active) return null;

  const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  const doneSets = completedSets.length;
  const errorBox = error && (
    <div role="alert" className="rounded-md bg-danger-soft p-3 text-[15px] leading-[1.45] text-danger">{error}</div>
  );

  // The chat sits in the header slot on purpose: it is reachable at any point of
  // the session — usually while resting — without taking space next to
  // "Próximo", which is the button being hit with one hand mid-set.
  const chatButton = (
    <button
      type="button"
      onClick={() => setShowChat(true)}
      aria-label="Tirar dúvida sobre o treino"
      className="press min-h-[44px] rounded-chip bg-brand-soft px-4 text-[15px] font-semibold text-brand-fg"
    >
      Dúvidas
    </button>
  );

  // Applying a chat-proposed substitution updates the same slot `refresh()`
  // writes into: the phase state (`currentExerciseId`, weights typed so far)
  // is keyed by exercise id, which a substitution never changes, so nothing
  // about it needs to move.
  const applySubstitution = (updated: ActiveWorkout) => {
    setActive(updated);
    setShowChat(false);
  };

  // Rendered by the execution screen and by the handover, so a question is never
  // more than one tap away while the session is running.
  const chatNode = showChat && (
    <WorkoutChat
      workoutId={active.workout.id}
      onClose={() => setShowChat(false)}
      exerciseName={currentExercise?.exercise_name}
      exercises={exercises}
      onSubstituted={applySubstitution}
    />
  );

  // Rendered by both the main screen and the handover, so finishing early is
  // always one tap away wherever the session happens to be.
  const finishSheetNode = finishSheet && (
    <div className="fixed inset-0 z-[110] flex items-end bg-bg/80 backdrop-blur-sm" onClick={() => setFinishSheet(null)}>
      <div
        className="sheet-in max-h-[85vh] w-full overflow-y-auto rounded-t-xl bg-surface p-5 shadow-sheet pb-safe"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Finalizar treino agora"
      >
        <h3 className="num text-[28px] leading-[1.05] text-fg">Finalizar treino agora</h3>
        <p className="mt-1.5 text-[15px] leading-[1.45] text-muted">
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
          <button type="button" onClick={() => setFinishSheet(null)} className="press min-h-[48px] w-full rounded-md text-[16px] font-semibold text-muted">
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
        <div className="space-y-4 px-5 py-6 pb-24">
          {/* O degradê da marca fica neste cartão: é o único da tela. */}
          <div className="enter rounded-xl bg-hero p-5 text-center text-white shadow-card">
            <p className="text-[15px] font-semibold leading-[1.45] opacity-90">{active.day_name || active.workout.name}</p>
            <p className="num mt-2 text-[44px] leading-none"><CountUp value={doneSets} /></p>
            <p className="mt-1 text-[15px] font-semibold">séries concluídas</p>
            {volume > 0 && (
              <p className="mt-3 text-[15px] font-semibold">{volume.toLocaleString('pt-BR')} kg de volume total</p>
            )}
          </div>
          <div className="space-y-3">
            {exercises.map((exercise) => {
              const feitas = doneCountFor(exercise.id);
              return (
                <Card key={exercise.id} className="enter flex items-center justify-between gap-3 !py-3">
                  <span className="break-anywhere min-w-0 text-[16px] font-semibold leading-snug text-fg">{exercise.exercise_name}</span>
                  <span className={`num shrink-0 text-[20px] ${feitas >= exercise.sets ? 'text-ok' : 'text-muted'}`}>{feitas}/{exercise.sets}</span>
                </Card>
              );
            })}
          </div>
          {errorBox}
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
    const handoverDone = handoverRestLeft <= 0;
    const startNext = () => {
      setFinishedExerciseId(null);
      setCurrentExerciseId(currentExercise.id ?? null);
      startPhase(settings.countdown_seconds > 0 ? 'countdown' : 'executing');
    };

    return (
      <>
        <Header title={active.day_name || active.workout.name} rightAction={chatButton} />
        <div className="space-y-4 px-5 py-4 pb-32">
          {errorBox}

          <Bar progress={totalSets ? doneSets / totalSets : 0} />

          {finished && (
            <Card tint="ok" className="enter">
              <p className={`text-ok ${EYEBROW}`}>Exercício concluído</p>
              <h2 className="break-anywhere num mt-1 text-[28px] leading-[1.05] text-fg">{finished.exercise_name}</h2>
              <div className="mt-3 space-y-2">
                {finishedSets.map((set, index) => (
                  <div key={set.id} className="flex items-center justify-between gap-3 rounded-sm bg-surface-2 px-3 py-2.5 text-[15px]">
                    <span className="text-muted">{index + 1}ª série</span>
                    <span className="num text-[18px] text-fg">
                      {set.tracking_type === 'time'
                        ? formatClock(set.duration_seconds ?? 0)
                        : `${set.reps} reps${set.weight_kg > 0 ? ` · ${set.weight_kg} kg` : ''}`}
                    </span>
                  </div>
                ))}
              </div>
              {finishedVolume > 0 && (
                <p className="mt-3 text-[15px] font-semibold text-ok">Volume: {finishedVolume.toLocaleString('pt-BR')} kg</p>
              )}
            </Card>
          )}

          {handoverRest > 0 && (
            <div className="flex flex-col items-center gap-2 py-1">
              <div className={handoverDone ? 'pulse-double' : ''}>
                <Ring progress={handoverDone ? 1 : handoverRestLeft / handoverRest} size={160} stroke={12} colorClass="text-teal">
                  <div className="text-center">
                    <p className="num text-[44px] leading-none text-teal">{formatClock(Math.max(0, handoverRestLeft))}</p>
                    <p className={`mt-1 text-muted ${EYEBROW}`}>Descanso</p>
                  </div>
                </Ring>
              </div>
              {handoverDone && <p className="text-[15px] font-semibold text-teal">Pronto para o próximo exercício</p>}
            </div>
          )}

          <p className={`text-center text-dim ${EYEBROW}`}>A seguir</p>

          <Card tint="brand" className="enter text-center">
            <p className={`text-brand-fg ${EYEBROW}`}>
              Exercício {exercises.length - pendingExercises.length + 1} de {exercises.length}
            </p>
            <h2 className="break-anywhere num mt-1 text-[28px] leading-[1.05] text-fg">{currentExercise.exercise_name}</h2>
            {currentExercise.substituted_from && (
              <p className="mt-1 text-[13px] text-muted">no lugar de {currentExercise.substituted_from}</p>
            )}
            {/* Aqui é onde o vídeo serve para alguma coisa: a pessoa está
                prestes a executar e ainda dá tempo de conferir o movimento.
                Não renderiza nada quando não há vídeo. */}
            <ExerciseVideoPlayer video={currentExercise.video} className="mx-auto mt-3 aspect-square w-full max-w-[320px]" />
            {!currentExercise.video && <ExerciseIllustration exercise={currentExercise} className="mt-3" />}
            <div className="mt-3 inline-flex items-baseline gap-2 rounded-lg bg-surface px-5 py-3 shadow-card">
              {currentExercise.tracking_type === 'time' ? (
                <>
                  <span className="num text-[38px] leading-none text-fg">{formatClock(currentExercise.duration_seconds ?? 0)}</span>
                  <span className="text-[15px] font-semibold text-muted">de execução</span>
                </>
              ) : (
                <>
                  <span className="num text-[38px] leading-none text-fg">{currentExercise.reps}</span>
                  <span className="text-[15px] font-semibold text-muted">repetições</span>
                </>
              )}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Chip>{currentExercise.sets} séries</Chip>
              {currentExercise.rest_seconds > 0 && <Chip>{currentExercise.rest_seconds}s descanso</Chip>}
              {currentExercise.last_weight_kg ? <Chip>última vez: {currentExercise.last_weight_kg} kg</Chip> : null}
            </div>
            {currentExercise.notes && (
              <p className="mt-3 text-[15px] leading-[1.45] text-muted">{currentExercise.notes}</p>
            )}
          </Card>

          <div className="space-y-2">
            <PhaseButton fase="executing" onClick={startNext}>Iniciar {currentExercise.exercise_name}</PhaseButton>
            <button
              type="button"
              onClick={() => setShowPostpone(true)}
              disabled={pendingExercises.length < 2}
              className={`${ACAO_SECUNDARIA} w-full`}
            >
              Escolher outro exercício
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={goBack}
                disabled={isBusy || completedSets.length === 0}
                className={`${ACAO_DISCRETA} text-muted disabled:opacity-[.45]`}
              >
                Refazer última série
              </button>
              <button type="button" onClick={openFinishSheet} className={`${ACAO_DISCRETA} text-brand-fg`}>
                Finalizar treino agora
              </button>
            </div>
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
  const restDone = phase === 'rest_done';
  const nextWeight = parseWeight(weightText);

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

        <div className="shrink-0 px-5 pt-1">
          {errorBox && <div className="mb-3">{errorBox}</div>}
          <div className="flex items-center justify-between gap-3 text-[13px] font-semibold text-muted [@media(max-height:600px)]:hidden">
            <span>{doneSets} de {totalSets} séries</span>
            <span>{pendingExercises.length} exercício{pendingExercises.length === 1 ? '' : 's'} restante{pendingExercises.length === 1 ? '' : 's'}</span>
          </div>
          <Bar className="mt-2" progress={totalSets ? doneSets / totalSets : 0} />
        </div>

        {/* O miolo. Sem rolagem: tudo o que a pessoa precisa a cada série — mídia
            inteira, carga e botão — tem de caber na tela, então só a mídia é
            elástica (`min-h-0 flex-1`) e encolhe com `object-contain`, nunca
            recorta. O stepper de carga fica fora da área elástica: antes ele
            era o último item de uma coluna que rolava e a mídia o empurrava
            para fora da tela. */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-5 pt-3 text-center">
          <div className="shrink-0">
            <p className={`${phaseTone[phase].text} ${EYEBROW}`}>
              Série {currentSetNumber} de {currentExercise.sets}
            </p>
            <h2 className="break-anywhere num mt-0.5 line-clamp-2 text-[24px] [@media(max-height:600px)]:text-[20px] leading-[1.05] text-fg">{currentExercise.exercise_name}</h2>
            {currentExercise.substituted_from && (
              <p className="mt-0.5 text-[13px] text-muted">no lugar de {currentExercise.substituted_from}</p>
            )}
          </div>

          {/* Em tela baixa o "Série X de Y" acima já diz o mesmo; a faixa cede o
              espaço para a mídia. */}
          {!telaBaixa && <FaixaDeSeries total={currentExercise.sets} feitas={currentSetNumber - 1} fase={phase} />}

          {/* Duas leituras da mesma tela, conforme o que a pessoa está fazendo.
              Durante o esforço o que importa é ver o movimento, então a mídia
              fica com toda a folga e cronômetro e alvo dividem uma linha acima.
              No descanso não há movimento para conferir: o anel assume, porque
              aí o tempo é a única coisa que interessa. */}
          {emDescanso ? (
            <div key="descanso" className="enter flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
              <div className={`shrink-0 ${restDone ? 'pulse-double' : ''}`}>
                <Ring
                  progress={restDone || restSeconds <= 0 ? 1 : Math.max(0, restLeft) / restSeconds}
                  size={telaMuitoBaixa ? 88 : telaBaixa ? 104 : 128}
                  stroke={telaMuitoBaixa ? 8 : telaBaixa ? 9 : 10}
                  colorClass="text-teal"
                >
                  <div className="text-center">
                    <p className={`num leading-none text-teal ${telaMuitoBaixa ? 'text-[26px]' : telaBaixa ? 'text-[30px]' : 'text-[36px]'}`}>{restDone ? '0:00' : formatClock(restLeft)}</p>
                    {!telaMuitoBaixa && <p className={`mt-1 text-muted ${EYEBROW}`}>Descanso</p>}
                  </div>
                </Ring>
              </div>
              {restDone && <p className="shrink-0 text-[15px] font-semibold text-teal">Pronto para a próxima série</p>}
              <div className="w-full shrink-0 rounded-lg bg-surface px-4 py-2.5 shadow-card">
                <p className={`text-dim ${EYEBROW}`}>Próxima série · {currentSetNumber} de {currentExercise.sets}</p>
                <p className="num mt-1 text-[22px] leading-[1.1] text-teal">
                  {isTimed
                    ? formatClock(currentExercise.duration_seconds ?? 0)
                    : `${nextWeight > 0 ? `${String(nextWeight).replace('.', ',')} kg × ` : ''}${currentExercise.reps} reps`}
                </p>
              </div>
            </div>
          ) : (
            <div key="esforco" className="fade-in-mob flex min-h-0 flex-1 flex-col gap-2">
              <div className="grid shrink-0 grid-cols-2 gap-3">
                <SeloDoCronometro
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
              {currentExercise.video ? (
                // Absorve toda a folga que sobrar. `h-full w-full object-contain`:
                // a mídia (quadrada, retrato ou paisagem) cabe inteira no espaço,
                // com faixas se a proporção não casar, e nunca é recortada. O
                // mesmo contêiner mostra "Carregando vídeo…" enquanto o vídeo
                // não está disponível, no mesmo tamanho.
                <div className="min-h-[72px] flex-1">
                  <ExerciseVideoPlayer video={currentExercise.video} className="h-full w-full object-contain" />
                </div>
              ) : (
                // Sem vídeo: o estado "não encontramos" (ou a ilustração) ocupa
                // o espaço restante; se o conteúdo não couber, rola por dentro
                // da área em vez de empurrar o stepper e o botão.
                <div className="flex min-h-[72px] flex-1 flex-col overflow-y-auto">
                  <ExerciseIllustration exercise={currentExercise} className="my-auto w-full" fit />
                </div>
              )}
              {currentExercise.notes && (
                <p className="line-clamp-2 shrink-0 text-[13px] leading-snug text-muted [@media(max-height:760px)]:hidden">{currentExercise.notes}</p>
              )}
            </div>
          )}

          {!isTimed && (
            <StepperDeCarga
              value={weightText}
              placeholder={currentExercise.last_weight_kg ? String(currentExercise.last_weight_kg) : '0'}
              onChange={setWeightText}
              onStep={stepWeight}
            />
          )}
        </div>

        {/* Rodapé ancorado. `pb-24` livra a barra de navegação, que é fixa e
            flutua por cima de tudo. */}
        <div className="shrink-0 space-y-2 px-5 pb-[72px] pt-3">
          <div className="relative">
            {phase === 'executing' && (
              <PhaseButton fase="executing" onClick={() => recordSet(elapsed)} disabled={isBusy}>
                {isTimed ? 'Concluir agora' : 'Concluí a série'}
              </PhaseButton>
            )}
            {phase === 'countdown' && (
              <PhaseButton fase="countdown" onClick={() => startPhase('executing')}>Começar agora</PhaseButton>
            )}
            {phase === 'resting' && (
              <PhaseButton fase="resting" onClick={advanceAfterRest}>Pular descanso</PhaseButton>
            )}
            {phase === 'rest_done' && (
              <PhaseButton fase="rest_done" onClick={advanceAfterRest} pulse>Continuar</PhaseButton>
            )}
            {sparking && <Sparks />}
          </div>

          {/* Secundárias: quatro botões iguais em grade. Finalizar e descartar são
              saídas, não o caminho normal, mas ainda assim têm de parecer
              tocáveis — texto solto lia-se como legenda. */}
          <div className="grid grid-cols-4 gap-2">
            <button type="button" onClick={goBack} disabled={isBusy || completedSets.length === 0} aria-label="Voltar série" className={`${ACAO_RODAPE} text-fg`}>
              <svg {...ICONE_RODAPE}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
              Voltar
            </button>
            <button type="button" onClick={() => setShowPostpone(true)} disabled={pendingExercises.length < 2} aria-label="Adiar exercício" className={`${ACAO_RODAPE} text-fg`}>
              <svg {...ICONE_RODAPE}><path d="M5 4l10 8-10 8z" /><path d="M19 5v14" /></svg>
              Adiar
            </button>
            <button type="button" onClick={openFinishSheet} aria-label="Finalizar treino agora" className={`${ACAO_RODAPE} text-brand-fg`}>
              <svg {...ICONE_RODAPE}><path d="M5 13l4 4L19 7" /></svg>
              Finalizar
            </button>
            <button type="button" onClick={cancel} aria-label="Descartar treino" className={`${ACAO_RODAPE} text-danger`}>
              <svg {...ICONE_RODAPE}><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></svg>
              Descartar
            </button>
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
