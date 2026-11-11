import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { EmptyState, ErrorState, SkelRows, stagger } from '../components/treinos/states';
import { Archive, Calendar, ChevronRight } from '../components/treinos/icons';
import { trainingPlansApi } from '../api/trainingPlans';
import { getErrorMessage } from '../api/client';
import type { TrainingPlan } from '../types';

// Listagem simples, direto da API: diferente dos planos ativos, não há treino
// da vez para calcular offline aqui, então não vale o local-first da tela
// principal. É só um arquivo morto para consulta.
export function ArchivedTrainingPlansPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);
    trainingPlansApi.list({ archived: true })
      .then(setPlans)
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Header title="Arquivados" showBack />
      <div className="space-y-[14px] px-5 pb-28 pt-2">
        {error && <ErrorState message={error} onRetry={load} />}

        {isLoading ? (
          <SkelRows count={3} />
        ) : plans.length === 0 && !error ? (
          <EmptyState icon={<Archive />} title="Nada arquivado" text="Quando você fechar um plano depois da data-alvo, ele aparece aqui para consulta." action={{ label: 'Voltar para treinos', onClick: () => navigate('/workouts') }} />
        ) : (
          plans.map((plan, index) => (
            <div key={plan.id} className="enter" style={stagger(index)}>
              <Card onClick={() => navigate(`/training-plans/${plan.id}`)} className="flex min-h-[72px] items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted"><Archive className="h-6 w-6" /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-[17px] font-bold leading-[1.3] text-fg">{plan.name}</h2>
                  <div className="mt-2">
                    <Chip icon={<Calendar />}>Encerrado em {plan.archived_at ? new Date(plan.archived_at).toLocaleDateString('pt-BR') : 'sem data'}</Chip>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-dim" />
              </Card>
            </div>
          ))
        )}
      </div>
    </>
  );
}
