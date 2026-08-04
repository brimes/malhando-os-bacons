import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { PlanWeekCard } from '../components/PlanWeekCard';
import { computePlanWeekProgress } from '../lib/planProgress';
import { pendingCompletedWorkouts, useOfflineStore } from '../lib/offline';
import { useLocalAll } from '../lib/local/useLocal';
import { pullTrainingPlans, trainingPlansCache } from '../lib/local/repo/trainingPlans';
import { pullWorkouts, workoutsCache } from '../lib/local/repo/workouts';

function lastDoneLabel(lastDoneAt: number | null) {
  if (lastDoneAt === null) return 'ainda não feito';
  const done = new Date(lastDoneAt);
  if (done.toDateString() === new Date().toDateString()) return 'feito hoje';
  return `última vez ${done.toLocaleDateString('pt-BR')}`;
}

export function WorkoutsPage() {
  const navigate = useNavigate();
  // Lê do aparelho e desenha na hora; a rede só revalida em segundo plano. Antes
  // esta tela esperava duas requisições em série para mostrar qualquer coisa, e
  // com internet lenta isso era o app "demorando para abrir".
  const plans = useLocalAll(trainingPlansCache);
  const history = useLocalAll(workoutsCache);
  const [isLoading, setIsLoading] = useState(!trainingPlansCache.isLoaded());
  // Sessions finished with no signal live only in the queue; re-render when it moves.
  const queue = useOfflineStore((state) => state.queue);

  useEffect(() => {
    let alive = true;
    void trainingPlansCache.ensureLoaded().then(() => { if (alive) setIsLoading(false); });
    // Revalidação: não bloqueia nada da tela, que já desenhou do local.
    void pullTrainingPlans();
    void pullWorkouts();
    return () => { alive = false; };
  }, []);

  const trackedPlan = plans.find((plan) => plan.active) ?? null;
  // O detalhe (com os dias) e o resumo convivem no mesmo store — `rememberPlan`
  // preserva `days` quando a listagem, que não os traz, chega por cima.
  const detail = trackedPlan?.days?.length ? trackedPlan : null;
  const progress = useMemo(() => {
    if (!trackedPlan) return null;
    return computePlanWeekProgress({
      plan: detail ?? trackedPlan,
      workouts: history,
      pending: pendingCompletedWorkouts(queue),
    });
  }, [trackedPlan, detail, history, queue]);

  return (
    <>
      <Header title="Planos de treino" rightAction={<Button size="sm" onClick={() => navigate('/training-plans/new')}>+ Plano</Button>} />
      <div className="space-y-4 px-4 py-4 pb-24">
        {progress && trackedPlan && <PlanWeekCard progress={progress} />}

        {isLoading ? <div className="py-16 text-center text-zinc-500">Carregando planos...</div> : plans.length === 0 ? (
          <div className="space-y-4 py-14 text-center"><img src="/mob-icon.png" alt="" className="mx-auto h-24 w-24 rounded-3xl object-cover opacity-80" /><h2 className="text-xl font-bold text-white">Seu treino começa com um plano</h2><p className="mx-auto max-w-xs text-sm text-zinc-500">Deixe o assistente criar tudo com base no seu objetivo ou monte cada treino manualmente.</p><Button onClick={() => navigate('/training-plans/new')}>Criar primeiro plano</Button></div>
        ) : (
          <div className="space-y-3">{plans.map((plan) => {
            // O treino da vez só existe para o plano acompanhado, e vive dentro
            // do cartão dele em vez de num cartão próprio: é o mesmo assunto.
            const next = plan.id === trackedPlan?.id ? progress?.days.find((entry) => entry.isNext) : undefined;
            return (
            <Card key={plan.id} onClick={() => navigate(`/training-plans/${plan.id}`)}>
              <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-bold text-white">{plan.name}</h2>{plan.creation_method === 'automatic' && <span className="rounded-full bg-primary-950 px-2 py-0.5 text-[9px] font-semibold text-primary-300">IA</span>}</div><p className="mt-1 line-clamp-2 text-xs text-zinc-500">{plan.description}</p></div><span className="text-zinc-600">›</span></div>

              {progress?.daysUnknown && plan.id === trackedPlan?.id && (
                <p className="mt-3 rounded-xl bg-zinc-950 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
                  Abra este plano uma vez com internet para que o treino da vez fique disponível offline.
                </p>
              )}

              {next?.day.id && (
                <button
                  type="button"
                  // O cartão inteiro navega para o plano; sem isto, tocar em
                  // Iniciar abriria o plano em vez de começar o treino.
                  onClick={(event) => { event.stopPropagation(); navigate(`/training-plans/${(detail ?? plan).id}/days/${next.day.id}`); }}
                  className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl bg-primary-950/60 px-3 py-3 text-left ring-1 ring-primary-800"
                >
                  <span className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-widest text-primary-400">Treino da vez</span>
                    <span className="mt-0.5 block truncate font-bold text-white">{next.day.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500">
                      {next.day.focus ? `${next.day.focus} · ` : ''}{lastDoneLabel(next.lastDoneAt)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-bold text-white">Iniciar ›</span>
                </button>
              )}

              <div className="mt-4 flex items-center gap-4 border-t border-zinc-800 pt-3 text-xs text-zinc-400"><span><strong className="text-white">{plan.days_per_week}x</strong> semana</span><span><strong className="text-white">{plan.session_duration_minutes}</strong> min</span><span className="ml-auto">até {new Date(`${plan.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</span></div>
            </Card>
            );
          })}</div>
        )}

        <button onClick={() => navigate('/workouts/history')} className="flex w-full items-center justify-between rounded-2xl border border-primary-900 bg-primary-950/50 px-4 py-3 text-left"><div><p className="text-sm font-semibold text-primary-300">Histórico de treinos</p><p className="text-xs text-zinc-500">Calendário e sessões já realizadas</p></div><span className="text-xl text-primary-400">›</span></button>

        <button onClick={() => navigate('/workouts/new')} className="w-full py-2 text-sm text-zinc-600 hover:text-zinc-400">Registrar treino livre</button>
      </div>
    </>
  );
}
