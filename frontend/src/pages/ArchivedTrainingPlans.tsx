import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { trainingPlansApi } from '../api/trainingPlans';
import { getErrorMessage } from '../api/client';
import type { TrainingPlan } from '../types';

// Listagem simples, direto da API: diferente dos planos ativos, não há treino
// da vez para calcular offline aqui, então não vale o local-first da tela
// principal — é só um arquivo morto para consulta.
export function ArchivedTrainingPlansPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trainingPlansApi.list({ archived: true })
      .then(setPlans)
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <>
      <Header title="Planos arquivados" showBack />
      <div className="space-y-3 px-4 py-5 pb-24">
        {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

        {isLoading ? (
          <div className="py-16 text-center text-zinc-500">Carregando planos arquivados...</div>
        ) : plans.length === 0 ? (
          <p className="py-14 text-center text-sm text-zinc-500">Nenhum plano arquivado ainda.</p>
        ) : (
          plans.map((plan) => (
            <Card key={plan.id} onClick={() => navigate(`/training-plans/${plan.id}`)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-bold text-white">{plan.name}</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Encerrado em {plan.archived_at ? new Date(plan.archived_at).toLocaleDateString('pt-BR') : '—'}
                  </p>
                </div>
                <span className="shrink-0 text-zinc-600">›</span>
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
