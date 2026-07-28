import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { trainingPlansApi } from '../api/trainingPlans';
import type { TrainingPlan } from '../types';

export function TrainingPlanDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    trainingPlansApi.get(Number(id)).then(setPlan).finally(() => setIsLoading(false));
  }, [id]);

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

  return (
    <>
      <Header title={plan.name} showBack rightAction={<div className="relative"><button aria-label="Opções do plano" onClick={() => setMenuOpen((value) => !value)} className="rounded-lg px-3 py-1 text-xl text-zinc-400 hover:bg-zinc-800">⋮</button>{menuOpen && <div className="absolute right-0 top-10 z-50 w-52 rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-2xl"><button onClick={() => { setShowDetails((value) => !value); setMenuOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800">{showDetails ? 'Ocultar detalhes' : 'Detalhes do plano'}</button><button onClick={() => navigate('/workouts/history')} className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800">Histórico de treinos</button><button onClick={() => navigate('/workouts/new')} className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800">Registrar treino livre</button><div className="my-1 border-t border-zinc-800" /><button disabled={isDeleting} onClick={deletePlan} className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-red-950/40 disabled:opacity-50">{isDeleting ? 'Excluindo...' : 'Excluir plano'}</button></div>}</div>} />
      <div className="space-y-5 px-4 py-5 pb-24">
        <Card className="border-primary-900 bg-primary-950/30">
          <div className="flex items-start justify-between gap-3"><p className="text-xs uppercase tracking-wide text-primary-400">{plan.creation_method === 'automatic' ? 'Criado pelo assistente' : 'Plano manual'}</p>{plan.adaptation_phase && <span className="rounded-full bg-amber-950 px-2 py-1 text-[10px] text-amber-300">Adaptação</span>}</div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div><p className="text-lg font-bold text-white">{plan.days_per_week}x</p><p className="text-[10px] text-zinc-600">por semana</p></div><div><p className="text-lg font-bold text-white">{plan.session_duration_minutes}</p><p className="text-[10px] text-zinc-600">minutos</p></div><div><p className="text-sm font-bold text-white">{new Date(`${plan.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</p><p className="text-[10px] text-zinc-600">data-alvo</p></div></div>
          {showDetails && <p className="mt-4 border-t border-primary-900/60 pt-4 text-sm leading-relaxed text-zinc-400">{plan.description}</p>}
          <button onClick={() => setShowDetails((value) => !value)} className="mt-3 text-xs font-medium text-primary-400">{showDetails ? 'Ocultar detalhes' : 'Ver detalhes do plano'}</button>
        </Card>

        <div className="space-y-4">
          {plan.days?.map((day) => <Card key={day.id} onClick={() => navigate(`/training-plans/${plan.id}/days/${day.id}`)}><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-primary-400">Treino {day.day_number}</p><h2 className="mt-0.5 text-lg font-bold text-white">{day.name}</h2><p className="mt-1 text-xs text-zinc-500">Última vez: {day.last_done_at ? new Date(day.last_done_at).toLocaleDateString('pt-BR') : 'ainda não feito'}</p></div><span className="text-2xl text-zinc-600">›</span></div></Card>)}
        </div>
      </div>
    </>
  );
}
