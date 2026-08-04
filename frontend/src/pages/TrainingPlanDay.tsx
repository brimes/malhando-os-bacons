import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
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
        <div className="space-y-4 px-4 py-10 text-center">
          <p className="text-sm text-zinc-400">
            Este treino ainda não foi aberto neste aparelho. Conecte-se uma vez para poder iniciá-lo sem internet.
          </p>
          <Button onClick={() => navigate('/workouts')}>Voltar para treinos</Button>
        </div>
      </>
    );
  }

  if (!plan || !day) return <div className="py-20 text-center text-zinc-500">Carregando treino...</div>;

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

  return (
    <>
      <Header title={day.name} showBack />
      <div className="space-y-4 px-4 py-5 pb-28">
        <div>
          <p className="text-sm text-zinc-500">{day.focus}</p>
          <p className="mt-1 text-xs text-zinc-600">
            Última vez: {day.last_done_at ? new Date(day.last_done_at).toLocaleDateString('pt-BR') : 'ainda não realizado'}
          </p>
        </div>

        {session && (
          <Card className="border-primary-800 bg-primary-950/40 text-sm text-primary-100">
            Treino em andamento — marque o que já fez ou volte para o acompanhamento.
          </Card>
        )}

        {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
        {day.instructions && <Card className="text-sm leading-relaxed text-zinc-400">{day.instructions}</Card>}

        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-zinc-500">{markedSets} de {totalSets} séries marcadas</p>
          <button
            type="button"
            onClick={() => setChecklist(Object.fromEntries(
              exercises.map((exercise) => [
                exercise.id as number,
                markedSets >= totalSets
                  ? { setsDone: lockedFor(exercise.id as number), weight: checklist[exercise.id as number]?.weight ?? '' }
                  : { setsDone: exercise.sets, weight: checklist[exercise.id as number]?.weight || (exercise.last_weight_kg ? String(exercise.last_weight_kg) : '') },
              ]),
            ))}
            className="text-xs font-semibold text-primary-400"
          >
            {markedSets >= totalSets ? 'Limpar marcações' : 'Marcar todos'}
          </button>
        </div>

        <WorkoutChecklist
          exercises={day.exercises}
          state={checklist}
          onChange={(exerciseId, entry) => setChecklist((current) => ({ ...current, [exerciseId]: entry }))}
          lockedFor={lockedFor}
        />

        <Button fullWidth size="lg" onClick={submit} isLoading={isBusy}>{label}</Button>
      </div>
    </>
  );
}
