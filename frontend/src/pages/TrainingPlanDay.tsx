import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CountUp } from '../components/CountUp';
import { EmptyState, Skel, stagger } from '../components/treinos/states';
import { Clock, Dumbbell, Play, Wifi } from '../components/treinos/icons';
import { WorkoutChecklist, type ChecklistState } from '../components/WorkoutChecklist';
import { trainingPlansApi } from '../api/trainingPlans';
import { workoutsApi } from '../api/workouts';
import { getErrorMessage } from '../api/client';
import { applyChecklistLocally, findCachedPlanDay, isNetworkOnline, onWorkoutIdRemap, storeLocalActiveWorkout } from '../lib/offline';
import { getPlan, rememberPlan, trainingPlansCache } from '../lib/local/repo/trainingPlans';
import type { ActiveWorkout, TrainingPlan, TrainingPlanDay } from '../types';

export function TrainingPlanDayPage() {
  const { planId, dayId } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [day, setDay] = useState<TrainingPlanDay | null>(null);
  const [session, setSession] = useState<ActiveWorkout | null>(null);
  const [checklist, setChecklist] = useState<ChecklistState>({});
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from the loading state: this day is not on the device at all
  // (never opened online, or its durable snapshot was never written), so
  // there is nothing to keep waiting for. Without this the screen used to
  // fall back to "Carregando treino..." forever whenever `trainingPlansApi.get`
  // rejected offline with nothing cached.
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!planId || !dayId) return;
    const numericDayId = Number(dayId);
    let cancelled = false;
    setPlan(null);
    setDay(null);
    setNotFound(false);

    (async () => {
      // O aparelho primeiro: se o plano já está aqui, a tela desenha sem
      // esperar rede nenhuma. Só quando ele não está é que a requisição
      // importa para o primeiro render.
      await trainingPlansCache.ensureLoaded();
      const local = getPlan(Number(planId));
      const localDay = local?.days?.find((item) => item.id === numericDayId) ?? null;
      if (!cancelled && local && localDay) {
        setPlan(local);
        setDay(localDay);
      }

      // Both requests fire together — neither waits on the other. `active()`
      // pre-fills the checklist for an open session on this same day, entirely
      // independent of the plan fetch, and with the client's default timeout a
      // wifi that hangs instead of failing fast would otherwise double the
      // wait by making one queue behind the other.
      const [active, planResult] = await Promise.all([
        workoutsApi.active().catch(() => null),
        trainingPlansApi.get(Number(planId))
          .then(async (result) => {
            // Guarda para a próxima visita — é o que faz abrir um plano uma vez
            // com internet deixá-lo disponível offline depois.
            await rememberPlan(result);
            const found = result.days?.find((item) => item.id === numericDayId) ?? null;
            return found ? { plan: result, day: found } : null;
          })
          // Offline, and this plan's generic cache entry was never written or
          // has since been pruned. Fall through to the durable per-day snapshot.
          .catch(() => null),
      ]);

      let planData: TrainingPlan | null = planResult?.plan ?? local ?? null;
      let dayData: TrainingPlanDay | null = planResult?.day ?? localDay ?? null;

      if (!dayData) {
        const cached = findCachedPlanDay(numericDayId);
        if (cached) {
          planData = cached.plan;
          dayData = cached.day;
        }
      }

      if (cancelled) return;
      if (!planData || !dayData) {
        setNotFound(true);
        return;
      }

      setPlan(planData);
      setDay(dayData);
      const openHere = active && active.workout.training_plan_day_id === numericDayId ? active : null;
      setSession(openHere);
      if (openHere) {
        setChecklist(Object.fromEntries(
          dayData.exercises.filter((exercise) => exercise.id).map((exercise) => {
            const done = openHere.workout.sets?.filter((set) => set.training_plan_exercise_id === exercise.id).length ?? 0;
            return [exercise.id as number, { setsDone: done, weight: exercise.last_weight_kg ? String(exercise.last_weight_kg) : '' }];
          }),
        ));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [planId, dayId]);

  // Same reason WorkoutSession.tsx subscribes: a session opened offline runs
  // on a negative id until the queued start reaches the server. Without this
  // the "Continuar"/"Finalizar" button below keeps sending to `/workouts/-1/...`
  // after the swap, which the server no longer has and answers with a 404 —
  // this screen holds its own copy of `session` and was the one place that
  // never learned about the remap.
  useEffect(() => onWorkoutIdRemap((localId, realId) => {
    setSession((current) => (
      current && current.workout.id === localId
        ? { ...current, workout: { ...current.workout, id: realId } }
        : current
    ));
  }), []);

  if (notFound) {
    return (
      <>
        <Header title="Treino" showBack />
        <EmptyState
          icon={<Wifi />}
          tint="teal"
          title="Treino ainda não baixado"
          text="Este treino não foi aberto neste aparelho. Conecte-se uma vez para poder iniciá-lo sem internet."
          action={{ label: 'Voltar para treinos', onClick: () => navigate('/workouts') }}
        />
      </>
    );
  }

  if (!plan || !day) {
    return (
      <>
        <Header title="Treino" showBack />
        <div role="status" aria-label="Carregando" className="space-y-[14px] px-5 pt-2">
          <Skel className="h-[220px] rounded-xl" />
          <Skel className="h-[120px] rounded-lg" />
          <Skel className="h-[120px] rounded-lg" />
          <Skel className="h-[120px] rounded-lg" />
        </div>
      </>
    );
  }

  const exercises = day.exercises.filter((exercise) => exercise.id);
  const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
  const markedSets = exercises.reduce((sum, exercise) => sum + (checklist[exercise.id as number]?.setsDone ?? 0), 0);
  const lockedFor = (exerciseId: number) =>
    session?.workout.sets?.filter((set) => set.training_plan_exercise_id === exerciseId).length ?? 0;

  const payload = () => Object.entries(checklist)
    .filter(([, entry]) => entry.setsDone > 0)
    .map(([id, entry]) => ({
      training_plan_exercise_id: Number(id),
      sets_done: entry.setsDone,
      weight_kg: Number((entry.weight || '0').replace(',', '.')) || 0,
    }));

  // One button, three meanings, driven by how much is ticked:
  // nothing -> start guided; some -> log those and continue guided; all -> close it.
  const mode = markedSets === 0 ? 'start' : markedSets >= totalSets ? 'finish' : 'continue';
  const label = mode === 'start' ? 'Iniciar treino' : mode === 'continue' ? 'Continuar o treino' : 'Finalizar o treino';

  const submit = async () => {
    if (!day.id || isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      const active = session ?? await workoutsApi.start(day.id);
      if (mode === 'start') {
        navigate('/workouts/session');
        return;
      }
      if (mode === 'finish') {
        await workoutsApi.complete(active.workout.id, { exercises: payload() });
        // Offline the server cannot close the session, so the local snapshot has
        // to — otherwise the next screen reopens a workout that is already done.
        if (!isNetworkOnline()) storeLocalActiveWorkout(null);
        navigate(`/training-plans/${plan.id}`);
        return;
      }
      await workoutsApi.progress(active.workout.id, { exercises: payload() });
      // Same reason: queued, the call answers with an echo instead of the updated
      // session, and the guided screen reads the session back from the cache.
      if (!isNetworkOnline()) applyChecklistLocally(active.workout.id, payload());
      navigate('/workouts/session');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setIsBusy(false);
    }
  };

  const allMarked = markedSets >= totalSets;
  return (
    <>
      <Header title={day.name} showBack />
      <div className="space-y-[14px] px-5 pb-8 pt-2">
        <div className="enter bg-hero rounded-xl p-5 text-white shadow-card">
          <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-white/90">{session ? 'Treino em andamento' : 'Hoje'}</p>
          {day.focus && <h2 className="num mt-1 break-words text-[32px] leading-[1.05]">{day.focus}</h2>}
          <div className="mt-5 flex items-end justify-between gap-4">
            <p className="num text-[56px] leading-none">
              <CountUp key={markedSets} value={markedSets} />
              <span className="font-sans text-[20px] font-semibold text-white/90"> de {totalSets} séries</span>
            </p>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-chip bg-white/25" role="progressbar" aria-valuenow={markedSets} aria-valuemin={0} aria-valuemax={totalSets}>
            <div className="h-full w-full origin-left rounded-chip bg-white transition-transform duration-ring ease-mob" style={{ transform: `scaleX(${totalSets ? markedSets / totalSets : 0})` }} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { icon: <Dumbbell />, text: `${exercises.length} ${exercises.length === 1 ? 'exercício' : 'exercícios'}` },
              { icon: <Clock />, text: day.last_done_at ? `Última vez em ${new Date(day.last_done_at).toLocaleDateString('pt-BR')}` : 'Ainda não realizado' },
            ].map((c) => (
              <span key={c.text} className="inline-flex h-8 items-center gap-1.5 rounded-chip bg-white/20 px-3 text-[13px] font-semibold text-white [&>svg]:h-[15px] [&>svg]:w-[15px]">{c.icon}{c.text}</span>
            ))}
          </div>
        </div>

        {error && <div role="alert" className="rounded-lg bg-danger-soft p-[18px] text-[15px] font-semibold text-danger">{error}</div>}
        {day.instructions && (
          <div className="enter" style={stagger(1)}>
            <Card tint="sun">
              <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">Instruções do dia</p>
              <p className="mt-1.5 text-[16px] leading-[1.5] text-fg">{day.instructions}</p>
            </Card>
          </div>
        )}

        <div className="enter flex items-center justify-between gap-3 pt-2" style={stagger(2)}>
          <h2 className="text-[17px] font-bold text-fg">Exercícios</h2>
          <button
            type="button"
            onClick={() => setChecklist(Object.fromEntries(
              exercises.map((exercise) => [
                exercise.id as number,
                allMarked
                  ? { setsDone: lockedFor(exercise.id as number), weight: checklist[exercise.id as number]?.weight ?? '' }
                  : { setsDone: exercise.sets, weight: checklist[exercise.id as number]?.weight || (exercise.last_weight_kg ? String(exercise.last_weight_kg) : '') },
              ]),
            ))}
            className="press -mr-2 min-h-[48px] rounded-md px-3 text-[15px] font-semibold text-brand-fg"
          >
            {allMarked ? 'Limpar marcações' : 'Marcar todos'}
          </button>
        </div>

        <div className="enter" style={stagger(3)}>
          <WorkoutChecklist
            exercises={day.exercises}
            state={checklist}
            onChange={(exerciseId, entry) => setChecklist((current) => ({ ...current, [exerciseId]: entry }))}
            lockedFor={lockedFor}
          />
        </div>
      </div>

      {/* Ação fixa acima da barra de navegação: com dez exercícios, ela não pode ficar lá embaixo. */}
      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 bg-gradient-to-t from-bg via-bg to-transparent px-5 pb-3 pt-6">
        <Button fullWidth size="lg" onClick={submit} isLoading={isBusy}>
          {mode === 'start' && <Play className="h-5 w-5" />}
          {label}
        </Button>
      </div>
      <div className="h-24" aria-hidden="true" />
    </>
  );
}
