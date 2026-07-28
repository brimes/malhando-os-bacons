import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { trainingPlansApi } from '../api/trainingPlans';
import type { TrainingPlan } from '../types';

export function WorkoutsPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    trainingPlansApi.list().then(setPlans).finally(() => setIsLoading(false));
  }, []);

  return (
    <>
      <Header title="Planos de treino" rightAction={<Button size="sm" onClick={() => navigate('/training-plans/new')}>+ Plano</Button>} />
      <div className="space-y-4 px-4 py-4 pb-24">
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
