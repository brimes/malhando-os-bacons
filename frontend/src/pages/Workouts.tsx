import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { PlanWeekCard } from '../components/PlanWeekCard';
import { trainingPlansApi } from '../api/trainingPlans';
import { workoutsApi } from '../api/workouts';
import { computePlanWeekProgress } from '../lib/planProgress';
import { pendingCompletedWorkouts, useOfflineStore } from '../lib/offline';
import type { TrainingPlan, Workout } from '../types';

export function WorkoutsPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  // Detail of the plan being tracked: the list endpoint carries no days, and the
  // days (with `last_done_at`) are what "o treino da vez" is computed from.
  const [detail, setDetail] = useState<TrainingPlan | null>(null);
  const [history, setHistory] = useState<Workout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Sessions finished with no signal live only in the queue; re-render when it moves.
  const queue = useOfflineStore((state) => state.queue);

  useEffect(() => {
    let alive = true;
    // Every GET below falls back to the local snapshot when the request dies, so
    // the screen fills in offline; the catch only fires when this device has never
    // seen the resource at all.
    trainingPlansApi.list()
      .then(async (list) => {
        if (!alive) return;
        setPlans(list);
        // No fallback to the first plan on purpose: the server's own "próximo
        // treino" (dashboard.go's fillTrainingSummary) only ever looks at
        // `p.active`, and picking a different plan here would show progress
        // and a "comece por aqui" for a plan the dashboard has no opinion on.
        const tracked = list.find((plan) => plan.active);
        if (!tracked) return;
        // Fetching it here also warms the cache, so the highlight keeps working
        // on the next visit with no connection.
        const full = await trainingPlansApi.get(tracked.id).catch(() => null);
        if (alive && full) setDetail(full);
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setIsLoading(false); });

    workoutsApi.list()
      .then((workouts) => { if (alive) setHistory(workouts); })
      .catch(() => undefined);

    return () => { alive = false; };
  }, []);

  const trackedPlan = plans.find((plan) => plan.active) ?? null;
  const progress = useMemo(() => {
    if (!trackedPlan) return null;
    return computePlanWeekProgress({
      // The detail wins when it is loaded: it is the only copy that has the days.
      plan: detail?.id === trackedPlan.id ? detail : trackedPlan,
      workouts: history,
      pending: pendingCompletedWorkouts(queue),
    });
  }, [trackedPlan, detail, history, queue]);

  return (
    <>
      <Header title="Planos de treino" rightAction={<Button size="sm" onClick={() => navigate('/training-plans/new')}>+ Plano</Button>} />
      <div className="space-y-4 px-4 py-4 pb-24">
        {progress && trackedPlan && (
          <PlanWeekCard
            progress={progress}
            planName={trackedPlan.name}
            onStartNext={(dayId) => navigate(`/training-plans/${(detail ?? trackedPlan).id}/days/${dayId}`)}
          />
        )}

        <button onClick={() => navigate('/workouts/history')} className="flex w-full items-center justify-between rounded-2xl border border-primary-900 bg-primary-950/50 px-4 py-3 text-left"><div><p className="text-sm font-semibold text-primary-300">Histórico de treinos</p><p className="text-xs text-zinc-500">Calendário e sessões já realizadas</p></div><span className="text-xl text-primary-400">›</span></button>

        {isLoading ? <div className="py-16 text-center text-zinc-500">Carregando planos...</div> : plans.length === 0 ? (
          <div className="space-y-4 py-14 text-center"><img src="/mob-icon.png" alt="" className="mx-auto h-24 w-24 rounded-3xl object-cover opacity-80" /><h2 className="text-xl font-bold text-white">Seu treino começa com um plano</h2><p className="mx-auto max-w-xs text-sm text-zinc-500">Deixe o assistente criar tudo com base no seu objetivo ou monte cada treino manualmente.</p><Button onClick={() => navigate('/training-plans/new')}>Criar primeiro plano</Button></div>
        ) : (
          <div className="space-y-3">{plans.map((plan) => (
            <Card key={plan.id} onClick={() => navigate(`/training-plans/${plan.id}`)}>
              <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-bold text-white">{plan.name}</h2>{plan.creation_method === 'automatic' && <span className="rounded-full bg-primary-950 px-2 py-0.5 text-[9px] font-semibold text-primary-300">IA</span>}</div><p className="mt-1 line-clamp-2 text-xs text-zinc-500">{plan.description}</p></div><span className="text-zinc-600">›</span></div>
              <div className="mt-4 flex items-center gap-4 border-t border-zinc-800 pt-3 text-xs text-zinc-400"><span><strong className="text-white">{plan.days_per_week}x</strong> semana</span><span><strong className="text-white">{plan.session_duration_minutes}</strong> min</span><span className="ml-auto">até {new Date(`${plan.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</span></div>
            </Card>
          ))}</div>
        )}

        <button onClick={() => navigate('/workouts/new')} className="w-full py-2 text-sm text-zinc-600 hover:text-zinc-400">Registrar treino livre</button>
      </div>
    </>
  );
}
