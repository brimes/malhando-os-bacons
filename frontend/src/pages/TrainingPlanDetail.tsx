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

const ADJUST_POLL_MS = 2000;
const ADJUST_DEADLINE_MS = 15 * 60 * 1000;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const EXAMPLES = [
  'Troque o agachamento livre por leg press, meu joelho incomoda',
  'Renomeie o plano para "Verão 2027"',
  'Adicione um exercício de abdômen no fim de cada treino',
  'O Treino A está muito longo, tire um exercício',
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
  // Sessions finished with no signal exist only in the queue; re-render when it moves.
  const queue = useOfflineStore((state) => state.queue);

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

  if (isLoading) return <div className="py-20 text-center text-zinc-500">Carregando plano...</div>;
  if (!plan) return <div className="py-20 text-center text-zinc-500">Plano não encontrado</div>;

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
      const deadline = Date.now() + ADJUST_DEADLINE_MS;
      while (Date.now() < deadline) {
        await wait(ADJUST_POLL_MS);
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

  return (
    <>
      <Header title={plan.name} showBack rightAction={<div className="relative"><button aria-label="Opções do plano" onClick={() => setMenuOpen((value) => !value)} className="rounded-lg px-3 py-1 text-xl text-zinc-400 hover:bg-zinc-800">⋮</button>{menuOpen && <div className="absolute right-0 top-10 z-50 w-52 rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-2xl"><button onClick={() => { setShowDetails((value) => !value); setMenuOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800">{showDetails ? 'Ocultar detalhes' : 'Detalhes do plano'}</button><button onClick={() => { setShowAdjust(true); setMenuOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-primary-300 hover:bg-zinc-800">Ajustar plano com IA</button><button onClick={() => navigate('/workouts/history')} className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800">Histórico de treinos</button><button onClick={() => navigate('/workouts/new')} className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800">Registrar treino livre</button><div className="my-1 border-t border-zinc-800" /><button disabled={isDeleting} onClick={deletePlan} className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-red-950/40 disabled:opacity-50">{isDeleting ? 'Excluindo...' : 'Excluir plano'}</button></div>}</div>} />
      <div className="space-y-5 px-4 py-5 pb-24">
        <Card className="border-primary-900 bg-primary-950/30">
          <div className="flex items-start justify-between gap-3"><p className="text-xs uppercase tracking-wide text-primary-400">{plan.creation_method === 'automatic' ? 'Criado pelo assistente' : 'Plano manual'}</p>{plan.adaptation_phase && <span className="rounded-full bg-amber-950 px-2 py-1 text-[10px] text-amber-300">Adaptação</span>}</div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div><p className="text-lg font-bold text-white">{plan.days_per_week}x</p><p className="text-[10px] text-zinc-600">por semana</p></div><div><p className="text-lg font-bold text-white">{plan.session_duration_minutes}</p><p className="text-[10px] text-zinc-600">minutos</p></div><div><p className="text-sm font-bold text-white">{new Date(`${plan.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</p><p className="text-[10px] text-zinc-600">data-alvo</p></div></div>
          {showDetails && <p className="mt-4 border-t border-primary-900/60 pt-4 text-sm leading-relaxed text-zinc-400">{plan.description}</p>}
          <button onClick={() => setShowDetails((value) => !value)} className="mt-3 text-xs font-medium text-primary-400">{showDetails ? 'Ocultar detalhes' : 'Ver detalhes do plano'}</button>
        </Card>

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
                className={entry.isNext ? 'border-primary-600 bg-primary-950/40 ring-1 ring-primary-700' : undefined}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold uppercase text-primary-400">Treino {day.day_number}</p>
                      {entry.isNext && (
                        <span className="rounded-full bg-primary-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                          Comece por aqui
                        </span>
                      )}
                      {entry.doneThisWeek > 0 && (
                        <span className="rounded-full bg-emerald-950 px-2 py-0.5 text-[9px] font-semibold text-emerald-300">
                          {entry.doneThisWeek}x nesta semana
                        </span>
                      )}
                      {entry.fromPendingQueue && (
                        <span className="rounded-full bg-sky-950 px-2 py-0.5 text-[9px] font-semibold text-sky-300">
                          aguardando envio
                        </span>
                      )}
                    </div>
                    <h2 className="mt-0.5 text-lg font-bold text-white">{day.name}</h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      Última vez: {entry.lastDoneAt ? new Date(entry.lastDoneAt).toLocaleDateString('pt-BR') : 'ainda não feito'}
                    </p>
                  </div>
                  <span className="text-2xl text-zinc-600">›</span>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {showAdjust && (
        <div className="fixed inset-0 z-[100] flex items-end bg-black/80 backdrop-blur-sm" onClick={() => !isAdjusting && setShowAdjust(false)}>
          <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-zinc-900 p-5" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-bold text-white">Ajustar plano</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Escreva o que quer mudar. O assistente reescreve só o que você pediu e mantém o resto
              como está — pode trocar exercícios, renomear o plano ou os treinos, e mudar o foco.
            </p>

            {adjustError && <div className="mt-3 rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{adjustError}</div>}

            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={4}
              maxLength={2000}
              disabled={isAdjusting}
              placeholder="Ex: troque o supino reto por supino com halteres e deixe o Treino B mais curto"
              className="mt-4 w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-white placeholder-zinc-600 focus:border-primary-500 focus:outline-none disabled:opacity-50"
            />

            {!isAdjusting && (
              <div className="mt-3 space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-zinc-600">Exemplos</p>
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" onClick={() => setInstructions(example)}
                    className="block w-full rounded-lg bg-zinc-950 px-3 py-2 text-left text-xs text-zinc-400">
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
                className="w-full py-3 text-sm text-zinc-500 disabled:opacity-40">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
