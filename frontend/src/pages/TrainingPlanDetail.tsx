import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
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

  if (isLoading) return <div className="py-20 text-center text-muted">Carregando plano...</div>;
  if (!plan) return <div className="py-20 text-center text-muted">Plano não encontrado</div>;

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

  return (
    <>
      <Header title={plan.name} showBack rightAction={<div className="relative"><button aria-label="Opções do plano" onClick={() => setMenuOpen((value) => !value)} className="rounded-lg px-3 py-1 text-xl text-muted hover:bg-surface-2">⋮</button>{menuOpen && <div className="absolute right-0 top-10 z-50 w-52 rounded-md border border-transparent bg-surface-2 p-1 shadow-2xl"><button onClick={() => { setShowDetails((value) => !value); setMenuOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface-2">{showDetails ? 'Ocultar detalhes' : 'Detalhes do plano'}</button><button onClick={() => { setShowAdjust(true); setMenuOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-brand-fg hover:bg-surface-2">Ajustar plano com IA</button><button onClick={() => navigate('/workouts/history')} className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface-2">Histórico de treinos</button><button onClick={() => navigate('/workouts/new')} className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface-2">Registrar treino livre</button><div className="my-1 border-t border-line" /><button disabled={isDeleting} onClick={deletePlan} className="w-full rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft disabled:opacity-50">{isDeleting ? 'Excluindo...' : 'Excluir plano'}</button></div>}</div>} />
      <div className="space-y-5 px-4 py-5 pb-24">
        <Card className="bg-brand-soft">
          <div className="flex items-start justify-between gap-3"><p className="text-xs uppercase tracking-wide text-brand-fg">{plan.creation_method === 'automatic' ? 'Criado pelo assistente' : 'Plano manual'}</p>{plan.adaptation_phase && <span className="rounded-full bg-sun-soft px-2 py-1 text-xs text-sun">Adaptação</span>}</div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div><p className="text-lg font-bold text-fg">{plan.days_per_week}x</p><p className="text-xs text-dim">por semana</p></div><div><p className="text-lg font-bold text-fg">{plan.session_duration_minutes}</p><p className="text-xs text-dim">minutos</p></div><div><p className="text-sm font-bold text-fg">{new Date(`${plan.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</p><p className="text-xs text-dim">data-alvo</p></div></div>
          {showDetails && <p className="mt-4 border-t pt-4 text-sm leading-relaxed text-muted">{plan.description}</p>}
          <button onClick={() => setShowDetails((value) => !value)} className="mt-3 text-xs font-medium text-brand-fg">{showDetails ? 'Ocultar detalhes' : 'Ver detalhes do plano'}</button>
        </Card>

        {archiveError && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{archiveError}</div>}
        {isArchived ? (
          <Card className="space-y-3">
            <p className="text-sm font-semibold text-muted">Plano encerrado</p>
            <p className="text-xs text-dim">Encerrado em {plan.archived_at ? new Date(plan.archived_at).toLocaleDateString('pt-BR') : '—'}.</p>
            <Button variant="secondary" fullWidth onClick={reopenPlan} isLoading={isArchiving}>Reabrir plano</Button>
          </Card>
        ) : isPastTargetDate ? (
          <Card className="space-y-3 bg-sun-soft">
            <p className="text-sm font-semibold text-sun">O prazo deste plano terminou</p>
            <p className="text-xs leading-relaxed text-sun/80">A data-alvo já passou. Você pode continuar usando normalmente ou fechar o plano.</p>
            <Button variant="secondary" fullWidth onClick={closePlan} isLoading={isArchiving}>Fechar plano</Button>
          </Card>
        ) : null}

        {plan.kind === 'dynamic' ? (
          <div className="space-y-4">
            <Card className="space-y-3 bg-brand-soft">
              <p className="text-sm font-semibold text-brand-fg">Treino gerado sob demanda</p>
              <p className="text-xs leading-relaxed text-dim">
                Cada toque em "Gerar o treino de hoje" cria um treino novo, pensado pra agora — não
                dá para reabrir um já gerado para editar. Gere só na hora de treinar.
              </p>
              {generateError && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{generateError}</div>}
              <Button fullWidth size="lg" onClick={generateToday} isLoading={isGeneratingDay}>
                {isGeneratingDay ? 'Gerando...' : 'Gerar o treino de hoje'}
              </Button>
            </Card>

            {Boolean(plan.days?.length) && (
              <div className="space-y-3">
                <h3 className="px-1 text-xs uppercase tracking-wide text-dim">Treinos já gerados</h3>
                {plan.days!.map((day) => (
                  <Card key={day.id} onClick={() => navigate(`/training-plans/${plan.id}/days/${day.id}`)}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-bold text-fg">{day.name}</h2>
                        <p className="mt-1 text-xs text-dim">
                          {day.generated_for
                            ? new Date(`${day.generated_for.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
                            : (day.focus || 'Sem foco definido')}
                        </p>
                      </div>
                      <span className="text-2xl text-dim">›</span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {progress && <PlanWeekCard progress={progress} />}

            <div className="space-y-4">
              {progress?.days.map((entry) => {
                const day = entry.day;
                return (
                  <Card
                    key={day.id}
                    onClick={() => navigate(`/training-plans/${plan.id}/days/${day.id}`)}
                    // The ring is the "comece por aqui" cue: it has to survive a
                    // glance at arm's length, with the phone on a bench.
                    className={entry.isNext ? 'bg-brand-soft' : undefined}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold uppercase text-brand-fg">Treino {day.day_number}</p>
                          {entry.isNext && (
                            <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                              Comece por aqui
                            </span>
                          )}
                          {entry.doneThisWeek > 0 && (
                            <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
                              {entry.doneThisWeek}x nesta semana
                            </span>
                          )}
                          {entry.fromPendingQueue && (
                            <span className="rounded-full bg-teal-soft px-2 py-0.5 text-xs font-semibold text-teal">
                              aguardando envio
                            </span>
                          )}
                        </div>
                        <h2 className="mt-0.5 text-lg font-bold text-fg">{day.name}</h2>
                        <p className="mt-1 text-xs text-dim">
                          Última vez: {entry.lastDoneAt ? new Date(entry.lastDoneAt).toLocaleDateString('pt-BR') : 'ainda não feito'}
                        </p>
                      </div>
                      <span className="text-2xl text-dim">›</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      {showAdjust && (
        <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={() => !isAdjusting && setShowAdjust(false)}>
          <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-xl bg-surface shadow-sheet sheet-in p-5" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-bold text-fg">Ajustar plano</h3>
            <p className="mt-1 text-xs leading-relaxed text-dim">
              Escreva o que quer mudar. O assistente reescreve só o que você pediu e mantém o resto
              como está — pode trocar exercícios, renomear o plano ou os treinos, e mudar o foco.
            </p>

            {adjustError && <div className="mt-3 rounded-md bg-danger-soft p-3 text-sm text-danger">{adjustError}</div>}

            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={4}
              maxLength={2000}
              disabled={isAdjusting}
              placeholder="Ex: troque o supino reto por supino com halteres e deixe o Treino B mais curto"
              className="mt-4 w-full resize-none rounded-md border border-transparent bg-surface-2 px-4 py-3 text-fg placeholder:text-dim disabled:opacity-50"
            />

            {!isAdjusting && (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs uppercase tracking-wide text-dim">Exemplos</p>
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" onClick={() => setInstructions(example)}
                    className="block w-full rounded-lg bg-surface-2 px-3 py-2 text-left text-xs text-muted">
                    {example}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-5 space-y-2">
              <Button fullWidth size="lg" onClick={submitAdjust} isLoading={isAdjusting} disabled={!instructions.trim()}>
                {isAdjusting ? 'Ajustando o plano...' : 'Aplicar ajuste'}
              </Button>
              <button type="button" disabled={isAdjusting} onClick={() => setShowAdjust(false)}
                className="w-full py-3 text-sm text-muted disabled:opacity-40">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {isGeneratingDay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm text-center">
            <div className="relative mx-auto h-28 w-28">
              <div className="absolute inset-0 animate-ping rounded-full bg-brand/20" />
              <img src="/mob-icon.png" alt="" className="relative h-28 w-28 animate-pulse rounded-3xl object-cover shadow-2xl" />
            </div>
            <div className="mx-auto mt-7 h-1.5 w-48 overflow-hidden rounded-full bg-surface-2"><div className="h-full w-2/3 animate-pulse rounded-full bg-brand" /></div>
            <h2 className="mt-5 text-xl font-black text-fg">Gerando o treino de hoje</h2>
            <p className="mt-2 text-sm text-brand-fg">{DYNAMIC_LOADING_MESSAGES[dynamicLoadingStep]}</p>
            <p className="mt-4 text-xs text-dim">Isso pode levar alguns minutos.</p>
          </div>
        </div>
      )}
    </>
  );
}
