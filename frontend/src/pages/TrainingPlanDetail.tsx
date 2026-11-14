import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { NextWorkoutHero } from '../components/treinos/NextWorkoutHero';
import { WaitOverlay } from '../components/treinos/WaitOverlay';
import { Sheet, SheetRow } from '../components/treinos/Sheet';
import { EmptyState, Skel, SkelRows, SectionTitle, stagger } from '../components/treinos/states';
import { Calendar, ChevronRight, Clock, Dumbbell, History, MoreDots, Pencil, Pin, Repeat, Spark, Trash } from '../components/treinos/icons';
import { PlanWeekCard } from '../components/PlanWeekCard';
import { trainingPlansApi } from '../api/trainingPlans';
import { getErrorMessage } from '../api/client';
import { computePlanWeekProgress } from '../lib/planProgress';
import { pendingCompletedWorkouts, useOfflineStore } from '../lib/offline';
import { getPlan, rememberPlan, trainingPlansCache } from '../lib/local/repo/trainingPlans';
import { listWorkouts, pullWorkouts, workoutsCache } from '../lib/local/repo/workouts';
import type { TrainingPlan, Workout } from '../types';

// Mesmo intervalo/prazo para ajuste e para gerar o dia de um plano dinâmico:
// os dois são um job rodando minutos contra o mesmo assistente.
const PLAN_JOB_POLL_MS = 2000;
const PLAN_JOB_POLL_DEADLINE_MS = 15 * 60 * 1000;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const EXAMPLES = [
  'Troque o agachamento livre por leg press, meu joelho incomoda',
  'Renomeie o plano para "Verão 2027"',
  'Adicione um exercício de abdômen no fim de cada treino',
  'O Treino A está muito longo, tire um exercício',
];

const DYNAMIC_LOADING_MESSAGES = [
  'Vendo o que você já treinou...',
  'Ajustando a carga de hoje...',
  'Escolhendo os exercícios...',
  'Definindo séries e descanso...',
  'Finalizando o treino de hoje...',
];

export function TrainingPlanDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [history, setHistory] = useState<Workout[]>([]);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [isGeneratingDay, setIsGeneratingDay] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [dynamicLoadingStep, setDynamicLoadingStep] = useState(0);
  // Sessions finished with no signal exist only in the queue; re-render when it moves.
  const queue = useOfflineStore((state) => state.queue);

  useEffect(() => {
    if (!isGeneratingDay) return;
    const interval = window.setInterval(() => setDynamicLoadingStep((step) => (step + 1) % DYNAMIC_LOADING_MESSAGES.length), 15000);
    return () => window.clearInterval(interval);
  }, [isGeneratingDay]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    // Aparelho primeiro: desenha com o que já está aqui e revalida depois. É o
    // que faz esta tela responder "o que falta essa semana?" dentro da academia
    // sem esperar rede que pode não vir.
    void Promise.all([trainingPlansCache.ensureLoaded(), workoutsCache.ensureLoaded()]).then(() => {
      if (!alive) return;
      const local = getPlan(Number(id));
      if (local) setPlan(local);
      setHistory(listWorkouts());
      setIsLoading(false);
    });

    trainingPlansApi.get(Number(id))
      .then(async (fresh) => { await rememberPlan(fresh); if (alive) setPlan(fresh); })
      .catch(() => undefined)
      .finally(() => { if (alive) setIsLoading(false); });
    void pullWorkouts().then(() => { if (alive) setHistory(listWorkouts()); });

    return () => { alive = false; };
  }, [id]);

  // The week and the day that is due are derived here instead of read from the
  // dashboard: that endpoint computes them on the server and is unreachable
  // exactly when they matter most.
  const progress = useMemo(
    () => (plan ? computePlanWeekProgress({ plan, workouts: history, pending: pendingCompletedWorkouts(queue) }) : null),
    [plan, history, queue],
  );

  if (isLoading) {
    return (
      <>
        <Header title="Plano" showBack />
        <div role="status" aria-label="Carregando" className="space-y-[14px] px-5 pt-2">
          <Skel className="h-8 w-2/3 rounded-chip" />
          <Skel className="h-[292px] rounded-xl" />
          <Skel className="h-[152px] rounded-lg" />
          <SkelRows count={2} />
        </div>
      </>
    );
  }
  if (!plan) {
    return (
      <>
        <Header title="Plano" showBack />
        <EmptyState icon={<Dumbbell />} title="Plano não encontrado" text="Ele pode ter sido excluído ou ainda não foi aberto neste aparelho." action={{ label: 'Voltar para treinos', onClick: () => navigate('/workouts') }} />
      </>
    );
  }

  const deletePlan = async () => {
    if (!window.confirm(`Excluir completamente o plano "${plan.name}"? Os treinos já realizados continuarão no histórico.`)) return;
    setIsDeleting(true);
    try {
      await trainingPlansApi.delete(plan.id);
      navigate('/workouts', { replace: true });
    } finally {
      setIsDeleting(false);
      setMenuOpen(false);
    }
  };

  // O ajuste roda em background como a criação: enfileira o job e acompanha.
  const submitAdjust = async () => {
    if (!instructions.trim() || isAdjusting) return;
    setIsAdjusting(true);
    setAdjustError(null);
    try {
      const job = await trainingPlansApi.adjust(plan.id, instructions.trim());
      const deadline = Date.now() + PLAN_JOB_POLL_DEADLINE_MS;
      while (Date.now() < deadline) {
        await wait(PLAN_JOB_POLL_MS);
        const status = await trainingPlansApi.getJob(job.id);
        if (status.status === 'done') {
          setPlan(await trainingPlansApi.get(plan.id));
          setShowAdjust(false);
          setInstructions('');
          setIsAdjusting(false);
          return;
        }
        if (status.status === 'failed') throw new Error(status.error || 'Não foi possível ajustar o plano');
      }
      throw new Error('O ajuste está demorando mais que o esperado. Tente novamente.');
    } catch (requestError) {
      setAdjustError(getErrorMessage(requestError));
      setIsAdjusting(false);
    }
  };

  // Comparação por string (AAAA-MM-DD) em vez de `Date`: evita o fuso horário
  // fazer a data-alvo do dia parecer "já passada" horas antes de acabar.
  const isPastTargetDate = plan.target_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
  const isArchived = Boolean(plan.archived_at);

  const closePlan = async () => {
    if (!window.confirm(`Fechar o plano "${plan.name}"? Ele sai da lista principal, mas continua disponível em planos arquivados.`)) return;
    setIsArchiving(true);
    setArchiveError(null);
    try {
      // Offline a resposta vem vazia (a mutação foi enfileirada): o fechamento
      // é aplicado no plano que já está em mãos, senão a lista principal
      // continuaria mostrando um plano que a pessoa acabou de fechar.
      const archived = await trainingPlansApi.archive(plan.id);
      await rememberPlan(archived ?? { ...plan, archived_at: new Date().toISOString(), active: false });
      navigate('/workouts', { replace: true });
    } catch (requestError) {
      setArchiveError(getErrorMessage(requestError));
      setIsArchiving(false);
    }
  };

  const reopenPlan = async () => {
    setIsArchiving(true);
    setArchiveError(null);
    try {
      const reopened = await trainingPlansApi.unarchive(plan.id) ?? { ...plan, archived_at: null, active: true };
      await rememberPlan(reopened);
      setPlan(reopened);
    } catch (requestError) {
      setArchiveError(getErrorMessage(requestError));
    } finally {
      setIsArchiving(false);
    }
  };

  // Cada toque gera um treino novo — não existe "reabrir para editar" o dia
  // antigo. O job roda minutos contra o assistente, mesmo padrão do ajuste.
  const generateToday = async () => {
    if (isGeneratingDay) return;
    setIsGeneratingDay(true);
    setGenerateError(null);
    try {
      const job = await trainingPlansApi.generateDynamicDay(plan.id);
      const deadline = Date.now() + PLAN_JOB_POLL_DEADLINE_MS;
      while (Date.now() < deadline) {
        await wait(PLAN_JOB_POLL_MS);
        const status = await trainingPlansApi.getJob(job.id);
        if (status.status === 'done' && status.plan_day_id) {
          navigate(`/training-plans/${plan.id}/days/${status.plan_day_id}`);
          return;
        }
        if (status.status === 'failed') throw new Error(status.error || 'Não foi possível gerar o treino de hoje');
      }
      throw new Error('A geração está demorando mais que o esperado. Tente novamente em instantes.');
    } catch (requestError) {
      setGenerateError(getErrorMessage(requestError));
      setIsGeneratingDay(false);
    }
  };

  const nextEntry = progress?.days.find((entry) => entry.isNext);
  const nextDay = nextEntry?.day;
  const nextSets = nextDay?.exercises?.reduce((sum, exercise) => sum + (exercise.sets ?? 0), 0) ?? 0;
  const targetLabel = new Date(`${plan.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
  const lastLabel = (at: number | null) => (at ? `Última vez em ${new Date(at).toLocaleDateString('pt-BR')}` : 'Ainda não feito');

  return (
    <>
      <Header
        title="Plano"
        showBack
        rightAction={
          <button aria-label="Opções do plano" onClick={() => setMenuOpen(true)} className="press -mr-3 flex h-12 w-12 items-center justify-center rounded-md text-muted">
            <MoreDots />
          </button>
        }
      />
      <div className="space-y-[14px] px-5 pb-28 pt-1">
        <h2 className="num break-anywhere text-[32px] leading-[1.05] text-fg">{plan.name}</h2>
        <div className="enter flex flex-wrap gap-2">
          <Chip tone="brand" icon={plan.creation_method === 'automatic' ? <Spark /> : <Pencil />}>{plan.creation_method === 'automatic' ? 'Assistente' : 'Manual'}</Chip>
          {plan.kind === 'dynamic' && <Chip tone="teal">Dinâmico</Chip>}
          {plan.adaptation_phase && <Chip tone="sun">Adaptação</Chip>}
          <Chip icon={<Repeat />}>{plan.days_per_week}x/semana</Chip>
          <Chip icon={<Clock />}>{plan.session_duration_minutes} min</Chip>
          <Chip icon={<Calendar />}>até {targetLabel}</Chip>
          {plan.gym_name && <Chip icon={<Pin />}>{plan.gym_name}</Chip>}
        </div>

        {showDetails && plan.description && (
          <Card className="enter"><p className="text-[15px] leading-[1.5] text-muted">{plan.description}</p></Card>
        )}

        {archiveError && <div role="alert" className="rounded-lg bg-danger-soft p-[18px] text-[15px] font-semibold text-danger">{archiveError}</div>}
        {isArchived ? (
          <Card tint="sun" className="space-y-3">
            <h2 className="text-[17px] font-bold text-fg">Plano encerrado</h2>
            <p className="text-[15px] text-muted">Encerrado em {plan.archived_at ? new Date(plan.archived_at).toLocaleDateString('pt-BR') : 'data não registrada'}.</p>
            <Button variant="secondary" fullWidth onClick={reopenPlan} isLoading={isArchiving}>Reabrir plano</Button>
          </Card>
        ) : isPastTargetDate ? (
          <Card tint="sun" className="space-y-3">
            <h2 className="text-[17px] font-bold text-sun">O prazo deste plano terminou</h2>
            <p className="text-[15px] leading-[1.45] text-muted">A data-alvo já passou. Você pode continuar usando normalmente ou fechar o plano.</p>
            <Button variant="secondary" fullWidth onClick={closePlan} isLoading={isArchiving}>Fechar plano</Button>
          </Card>
        ) : null}

        {plan.kind === 'dynamic' ? (
          <>
            <NextWorkoutHero
              eyebrow="Sob demanda"
              title="Treino de hoje"
              focus="Cada toque cria um treino novo, pensado para agora. Gere só na hora de treinar."
              buttonLabel={isGeneratingDay ? 'Gerando...' : 'Gerar o treino de hoje'}
              onStart={generateToday}
              busy={isGeneratingDay}
            />
            {generateError && <div role="alert" className="rounded-lg bg-danger-soft p-[18px] text-[15px] font-semibold text-danger">{generateError}</div>}

            {Boolean(plan.days?.length) && (() => {
              const groups: { label: string; items: NonNullable<TrainingPlan['days']> }[] = [];
              plan.days!.forEach((day) => {
                const label = day.generated_for
                  ? new Date(`${day.generated_for.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                  : 'Sem data';
                const group = groups.find((g) => g.label === label);
                if (group) group.items.push(day); else groups.push({ label, items: [day] });
              });
              return (
                <div className="enter space-y-[14px] pt-3" style={stagger(2)}>
                  <SectionTitle>Treinos já gerados</SectionTitle>
                  {groups.map((group) => (
                    <div key={group.label} className="space-y-3">
                      <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">{group.label}</p>
                      {group.items.map((day) => {
                        const d = day.generated_for ? new Date(`${day.generated_for.slice(0, 10)}T12:00:00`) : null;
                        return (
                          <Card key={day.id} onClick={() => navigate(`/training-plans/${plan.id}/days/${day.id}`)} className="flex min-h-[72px] items-center gap-4">
                            <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-brand-soft text-brand-fg">
                              <span className="num text-[22px] leading-none">{d ? d.getDate() : '-'}</span>
                              <span className="text-[12px] font-semibold uppercase leading-none">{d ? d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') : ''}</span>
                            </span>
                            <div className="min-w-0 flex-1">
                              <h3 className="truncate text-[17px] font-bold text-fg">{day.name}</h3>
                              {day.focus && <p className="mt-0.5 truncate text-[15px] text-muted">{day.focus}</p>}
                            </div>
                            <ChevronRight className="h-5 w-5 shrink-0 text-dim" />
                          </Card>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        ) : (
          <>
            {nextDay?.id && !isArchived && (
              <NextWorkoutHero
                eyebrow="Treino da vez"
                title={nextDay.name}
                focus={nextDay.focus}
                stats={[
                  { label: 'exercícios', value: nextDay.exercises?.length ?? 0 },
                  { label: 'séries', value: nextSets },
                  { label: 'minutos', value: plan.session_duration_minutes },
                ]}
                buttonLabel="Começar treino"
                onStart={() => navigate(`/training-plans/${plan.id}/days/${nextDay.id}`)}
                footnote={nextEntry ? lastLabel(nextEntry.lastDoneAt) : undefined}
              />
            )}
            {progress && <div className="enter" style={stagger(2)}><PlanWeekCard progress={progress} /></div>}

            <div className="enter space-y-[14px] pt-3" style={stagger(3)}>
              <SectionTitle>Treinos do plano</SectionTitle>
              {progress?.days.map((entry) => {
                const day = entry.day;
                return (
                  <Card key={day.id} tint={entry.isNext ? 'brand' : undefined} onClick={() => navigate(`/training-plans/${plan.id}/days/${day.id}`)} className="flex min-h-[72px] items-center gap-4">
                    <span className={`num flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-[26px] ${entry.isNext ? 'bg-brand text-white' : 'bg-surface-2 text-brand-fg'}`}>{day.day_number}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="break-anywhere text-[17px] font-bold leading-[1.3] text-fg">{day.name}</h3>
                      <p className="mt-0.5 text-[15px] text-muted">{lastLabel(entry.lastDoneAt)}</p>
                      {(entry.isNext || entry.doneThisWeek > 0 || entry.fromPendingQueue) && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {entry.isNext && <Chip tone="brand">Próximo</Chip>}
                          {entry.doneThisWeek > 0 && <Chip tone="ok">{entry.doneThisWeek}x nesta semana</Chip>}
                          {entry.fromPendingQueue && <Chip tone="teal">Aguardando envio</Chip>}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-dim" />
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      {menuOpen && (
        <Sheet label="Opções do plano" onClose={() => setMenuOpen(false)}>
          <h3 className="num mb-2 text-[26px] leading-[1.1] text-fg">Opções do plano</h3>
          <SheetRow icon={<Spark />} tone="brand" onClick={() => { setShowAdjust(true); setMenuOpen(false); }}>Ajustar plano com IA</SheetRow>
          <SheetRow icon={<Dumbbell />} onClick={() => { setShowDetails((value) => !value); setMenuOpen(false); }}>{showDetails ? 'Ocultar descrição do plano' : 'Ver descrição do plano'}</SheetRow>
          <SheetRow icon={<History />} onClick={() => navigate('/workouts/history')}>Histórico de treinos</SheetRow>
          <SheetRow icon={<Pencil />} onClick={() => navigate('/workouts/new')}>Registrar treino livre</SheetRow>
          <SheetRow icon={<Trash />} tone="danger" disabled={isDeleting} onClick={deletePlan}>{isDeleting ? 'Excluindo...' : 'Excluir plano'}</SheetRow>
          <Button variant="secondary" fullWidth className="mt-3" onClick={() => setMenuOpen(false)}>Fechar</Button>
        </Sheet>
      )}

      {showAdjust && (
        <Sheet label="Ajustar plano" onClose={() => !isAdjusting && setShowAdjust(false)}>
          <h3 className="num text-[26px] leading-[1.1] text-fg">Ajustar plano</h3>
          <p className="mt-2 text-[15px] leading-[1.45] text-muted">
            Escreva o que quer mudar. O assistente reescreve só o que você pediu e mantém o resto como está. Pode trocar exercícios, renomear o plano ou os treinos e mudar o foco.
          </p>

          {adjustError && <div role="alert" className="mt-3 rounded-md bg-danger-soft p-3 text-[15px] font-semibold text-danger">{adjustError}</div>}

          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={4}
            maxLength={2000}
            disabled={isAdjusting}
            aria-label="O que mudar no plano"
            placeholder="Ex: troque o supino reto por supino com halteres e deixe o Treino B mais curto"
            className="mt-4 w-full resize-none"
          />

          {!isAdjusting && (
            <div className="mt-4 space-y-2">
              <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">Exemplos</p>
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => setInstructions(example)}
                  className="press block min-h-[48px] w-full rounded-md bg-surface-2 px-4 py-3 text-left text-[15px] leading-[1.35] text-muted">
                  {example}
                </button>
              ))}
            </div>
          )}

          <div className="mt-5 space-y-2">
            <Button fullWidth size="lg" onClick={submitAdjust} isLoading={isAdjusting} disabled={!instructions.trim()}>
              {isAdjusting ? 'Ajustando o plano...' : 'Aplicar ajuste'}
            </Button>
            <Button variant="ghost" fullWidth disabled={isAdjusting} onClick={() => setShowAdjust(false)}>Cancelar</Button>
          </div>
        </Sheet>
      )}

      {isGeneratingDay && (
        <WaitOverlay title="Gerando o treino de hoje" message={DYNAMIC_LOADING_MESSAGES[dynamicLoadingStep]} hint="Isso pode levar alguns minutos." />
      )}
    </>
  );
}
