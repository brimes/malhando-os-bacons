import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { NextWorkoutHero } from '../components/treinos/NextWorkoutHero';
import { EmptyState, Skel, SkelRows, SectionTitle, stagger } from '../components/treinos/states';
import { Archive, Calendar, ChevronRight, Clock, Dumbbell, History, Pencil, Plus, Spark, Wifi } from '../components/treinos/icons';
import { PlanWeekCard } from '../components/PlanWeekCard';
import { computePlanWeekProgress } from '../lib/planProgress';
import { pendingCompletedWorkouts, useOfflineStore } from '../lib/offline';
import { useLocalAll } from '../lib/local/useLocal';
import { pullTrainingPlans, trainingPlansCache } from '../lib/local/repo/trainingPlans';
import { pullWorkouts, workoutsCache } from '../lib/local/repo/workouts';

function lastDoneLabel(lastDoneAt: number | null) {
  if (lastDoneAt === null) return 'Ainda não feito';
  const done = new Date(lastDoneAt);
  if (done.toDateString() === new Date().toDateString()) return 'Você já treinou hoje';
  return `Última vez em ${done.toLocaleDateString('pt-BR')}`;
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

  const next = progress?.days.find((entry) => entry.isNext);
  const nextDay = next?.day;
  const nextSets = nextDay?.exercises?.reduce((sum, exercise) => sum + (exercise.sets ?? 0), 0) ?? 0;
  const goPlan = (planId: number) => navigate(`/training-plans/${planId}`);

  const linkRow = (icon: React.ReactNode, tint: string, title: string, text: string, to: string, index: number) => (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="enter press flex min-h-[72px] w-full items-center gap-4 rounded-lg bg-surface p-[18px] text-left shadow-card"
      style={stagger(index)}
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md ${tint}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold text-fg">{title}</span>
        <span className="mt-0.5 block text-[15px] leading-[1.35] text-muted">{text}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-dim" />
    </button>
  );

  return (
    <>
      <Header
        title="Treinos"
        rightAction={
          <Button size="md" onClick={() => navigate('/training-plans/new')} aria-label="Criar plano de treino">
            <Plus className="h-5 w-5" /> Plano
          </Button>
        }
      />
      <div className="space-y-[14px] px-5 pb-28 pt-2">
        {isLoading ? (
          <div role="status" aria-label="Carregando" className="space-y-[14px]">
            <Skel className="h-[292px] rounded-xl" />
            <Skel className="h-[152px] rounded-lg" />
            <SkelRows count={2} />
          </div>
        ) : visiblePlans.length === 0 ? (
          <EmptyState
            icon={<Dumbbell />}
            title="Seu treino começa com um plano"
            text="Deixe o assistente montar tudo pelo seu objetivo ou escreva cada treino do seu jeito."
            action={{ label: 'Criar primeiro plano', onClick: () => navigate('/training-plans/new') }}
          />
        ) : (
          <>
            {nextDay?.id && trackedPlan && (
              <NextWorkoutHero
                eyebrow="Treino da vez"
                title={nextDay.name}
                focus={nextDay.focus}
                stats={[
                  { label: 'exercícios', value: nextDay.exercises?.length ?? 0 },
                  { label: 'séries', value: nextSets },
                  { label: 'minutos', value: trackedPlan.session_duration_minutes },
                ]}
                buttonLabel="Começar treino"
                onStart={() => navigate(`/training-plans/${(detail ?? trackedPlan).id}/days/${nextDay.id}`)}
                footnote={next ? lastDoneLabel(next.lastDoneAt) : undefined}
              />
            )}

            {!nextDay?.id && trackedPlan?.kind === 'dynamic' && (
              <NextWorkoutHero
                eyebrow="Sob demanda"
                title="Treino de hoje"
                focus="Gerado na hora, pensado para agora. Cada toque cria um treino novo."
                buttonLabel="Gerar o treino de hoje"
                onStart={() => goPlan(trackedPlan.id)}
              />
            )}

            {progress?.daysUnknown && trackedPlan && (
              <div className="enter flex items-start gap-3 rounded-lg bg-sun-soft p-[18px]" style={stagger(1)}>
                <Wifi className="mt-0.5 h-5 w-5 shrink-0 text-sun" />
                <p className="text-[15px] leading-[1.45] text-fg">
                  Abra o plano {trackedPlan.name} uma vez com internet para o treino da vez ficar disponível offline.
                </p>
              </div>
            )}

            {progress && trackedPlan && <div className="enter" style={stagger(2)}><PlanWeekCard progress={progress} /></div>}

            <div className="enter space-y-[14px] pt-3" style={stagger(3)}>
              <SectionTitle>Seus planos</SectionTitle>
              {visiblePlans.map((plan) => {
                const isTracked = plan.id === trackedPlan?.id;
                return (
                  <Card key={plan.id} tint={isTracked ? 'brand' : undefined} onClick={() => goPlan(plan.id)} className="flex min-h-[72px] items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-[17px] font-bold leading-[1.3] text-fg">{plan.name}</h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {plan.creation_method === 'automatic' && <Chip tone="brand" icon={<Spark />}>IA</Chip>}
                        {plan.kind === 'dynamic' && <Chip tone="teal">Dinâmico</Chip>}
                        <Chip icon={<Clock />}>{plan.session_duration_minutes} min</Chip>
                        <Chip icon={<Calendar />}>até {new Date(`${plan.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</Chip>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num text-[34px] leading-none text-fg">{plan.days_per_week}x</p>
                      <p className="mt-1 text-[13px] text-muted">por semana</p>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {!isLoading && (
          <div className="space-y-[14px] pt-3">
            {linkRow(<History className="h-6 w-6" />, 'bg-violet-soft text-violet', 'Histórico de treinos', 'Calendário e sessões já feitas', '/workouts/history', 4)}
            {linkRow(<Archive className="h-6 w-6" />, 'bg-surface-2 text-muted', 'Planos arquivados', 'Planos encerrados depois da data-alvo', '/training-plans/archived', 5)}
            <Button variant="secondary" size="md" fullWidth onClick={() => navigate('/workouts/new')}>
              <Pencil className="h-5 w-5" /> Registrar treino livre
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
