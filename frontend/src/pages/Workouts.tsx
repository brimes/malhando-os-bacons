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

  // Arquivado nunca aparece aqui, mesmo que ainda esteja no cache local: abrir
  // um plano arquivado (na tela de arquivados) o guarda pelo mesmo caminho que
  // guarda qualquer detalhe visitado, e sem este filtro ele voltaria a aparecer
  // na lista principal só por ter sido aberto uma vez.
  const visiblePlans = plans.filter((plan) => !plan.archived_at);
  const trackedPlan = visiblePlans.find((plan) => plan.active) ?? null;
  // O detalhe (com os dias) e o resumo convivem no mesmo store — `rememberPlan`
  // preserva `days` quando a listagem, que não os traz, chega por cima.
  const detail = trackedPlan?.days?.length ? trackedPlan : null;
  const progress = useMemo(() => {
    // Plano dinâmico não tem semana planejada: os dias que ele acumula são
    // treinos já gerados, não uma rotina a cumprir. Calcular progresso sobre
    // eles mostraria um "treino da vez" apontando para o treino de outro dia,
    // que é o oposto de gerar na hora.
    if (!trackedPlan || trackedPlan.kind === 'dynamic') return null;
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

        {isLoading ? <div className="py-16 text-center text-muted">Carregando planos...</div> : visiblePlans.length === 0 ? (
          <div className="space-y-4 py-14 text-center"><img src="/mob-icon.png" alt="" className="mx-auto h-24 w-24 rounded-3xl object-cover opacity-80" /><h2 className="text-xl font-bold text-fg">Seu treino começa com um plano</h2><p className="mx-auto max-w-xs text-sm text-muted">Deixe o assistente criar tudo com base no seu objetivo ou monte cada treino manualmente.</p><Button onClick={() => navigate('/training-plans/new')}>Criar primeiro plano</Button></div>
        ) : (
          <div className="space-y-3">{visiblePlans.map((plan) => {
            // O treino da vez só existe para o plano acompanhado, e vive dentro
            // do cartão dele em vez de num cartão próprio: é o mesmo assunto.
            const next = plan.id === trackedPlan?.id ? progress?.days.find((entry) => entry.isNext) : undefined;
            return (
            <Card key={plan.id} onClick={() => navigate(`/training-plans/${plan.id}`)}>
              <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 flex-wrap"><h2 className="font-bold text-fg">{plan.name}</h2>{plan.creation_method === 'automatic' && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-fg">IA</span>}{plan.kind === 'dynamic' && <span className="rounded-full bg-teal-soft px-2 py-0.5 text-xs font-semibold text-teal">Dinâmico</span>}</div><p className="mt-1 line-clamp-2 text-xs text-dim">{plan.description}</p></div><span className="text-dim">›</span></div>

              {progress?.daysUnknown && plan.id === trackedPlan?.id && (
                <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
                  Abra este plano uma vez com internet para que o treino da vez fique disponível offline.
                </p>
              )}

              {plan.kind === 'dynamic' && (
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); navigate(`/training-plans/${plan.id}`); }}
                  className="mt-3 flex w-full items-center justify-between gap-3 rounded-md bg-teal-soft px-3 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-widest text-teal">Sob demanda</span>
                    <span className="mt-0.5 block truncate font-bold text-fg">Gerar o treino de hoje</span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-teal px-3 py-1.5 text-xs font-bold text-fg">Abrir ›</span>
                </button>
              )}

              {next?.day.id && (
                <button
                  type="button"
                  // O cartão inteiro navega para o plano; sem isto, tocar em
                  // Iniciar abriria o plano em vez de começar o treino.
                  onClick={(event) => { event.stopPropagation(); navigate(`/training-plans/${(detail ?? plan).id}/days/${next.day.id}`); }}
                  className="mt-3 flex w-full items-center justify-between gap-3 rounded-md bg-brand-soft px-3 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-widest text-brand-fg">Treino da vez</span>
                    <span className="mt-0.5 block truncate font-bold text-fg">{next.day.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-dim">
                      {next.day.focus ? `${next.day.focus} · ` : ''}{lastDoneLabel(next.lastDoneAt)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white">Iniciar ›</span>
                </button>
              )}

              <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-xs text-muted"><span><strong className="text-fg">{plan.days_per_week}x</strong> semana</span><span><strong className="text-fg">{plan.session_duration_minutes}</strong> min</span><span className="ml-auto">até {new Date(`${plan.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</span></div>
            </Card>
            );
          })}</div>
        )}

        <button onClick={() => navigate('/workouts/history')} className="flex w-full items-center justify-between rounded-lg bg-brand-soft px-4 py-3 text-left"><div><p className="text-sm font-semibold text-brand-fg">Histórico de treinos</p><p className="text-xs text-dim">Calendário e sessões já realizadas</p></div><span className="text-xl text-brand-fg">›</span></button>

        <button onClick={() => navigate('/training-plans/archived')} className="flex w-full items-center justify-between rounded-lg bg-surface shadow-card px-4 py-3 text-left"><div><p className="text-sm font-semibold text-muted">Planos arquivados</p><p className="text-xs text-dim">Planos encerrados após a data-alvo</p></div><span className="text-xl text-dim">›</span></button>

        <button onClick={() => navigate('/workouts/new')} className="w-full py-2 text-sm text-dim hover:text-muted">Registrar treino livre</button>
      </div>
    </>
  );
}
