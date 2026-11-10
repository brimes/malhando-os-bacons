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
      className="press tint-sun flex min-h-[56px] w-full items-center justify-between gap-3 rounded-lg bg-surface px-[18px] py-3 text-left shadow-card"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-sun-soft text-sun" aria-hidden="true">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></svg>
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-fg">Compensação — {plan.name}</p>
          {expiresLabel && <p className="text-[13px] text-muted">válida até {expiresLabel}</p>}
        </div>
      </div>
      <svg className="h-5 w-5 shrink-0 text-dim" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
    </button>
  );
}
