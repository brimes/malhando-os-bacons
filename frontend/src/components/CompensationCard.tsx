import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trainingPlansApi } from '../api/trainingPlans';
import type { TrainingPlan } from '../types';

/**
 * Surfaces the current cheat-day compensation, if any, as a standalone card —
 * never mixed into the regular plan list or progress, since it is a separate
 * training_plans row (kind='compensation') that expires on its own.
 */
export function CompensationCard() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);

  useEffect(() => {
    trainingPlansApi.getCompensation().then(setPlan).catch(() => setPlan(null));
  }, []);

  if (!plan) return null;

  const expiresLabel = plan.expires_at
    ? new Date(plan.expires_at + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : null;

  return (
    <button
      onClick={() => navigate(`/training-plans/${plan.id}`)}
      className="flex w-full items-center justify-between rounded-2xl border border-amber-900 bg-amber-950/30 px-4 py-3 text-left"
    >
      <div>
        <p className="text-sm font-semibold text-amber-300">⚡ Compensação — {plan.name}</p>
        {expiresLabel && <p className="text-xs text-amber-200/70">válida até {expiresLabel}</p>}
      </div>
      <span className="text-xl text-amber-400">›</span>
    </button>
  );
}
