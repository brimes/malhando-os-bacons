import { useEffect, useState } from 'react';
import { useNutritionStore } from '../stores/useNutritionStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { nutritionApi } from '../api/nutrition';
import { getErrorMessage } from '../api/client';
import { Chip } from '../components/Chip';
import { CountUp } from '../components/CountUp';
import { EmptyState, ErrorState, SkeletonCard, SectionTitle } from '../components/nutricao/States';
import { LeafIcon, PlusIcon } from '../components/nutricao/icons';
import { MEAL_TYPE_LABELS } from '../types';

const loadingMessages = [
  'Lendo seu perfil e objetivo...',
  'Olhando o volume do seu treino...',
  'Escolhendo alimentos do dia a dia...',
  'Distribuindo as refeições...',
  'Conferindo as metas de macro...',
];
const POLL_INTERVAL_MS = 2000;
const POLL_DEADLINE_MS = 15 * 60 * 1000;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const ADJUST_EXAMPLES = [
  'Troque o jantar por algo com peixe',
  'Tire o glúten das refeições',
  'Quero mais proteína no café da manhã',
  'Aumente um pouco as calorias, estou com muita fome',
];

export function NutritionPlanPage() {
  const { plans: storePlans, activePlan, isLoading, error: loadError, fetchPlans, createPlan } = useNutritionStore();
  const plans = storePlans ?? [];

  const [method, setMethod] = useState<'automatic' | 'manual'>('automatic');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('2000');
  const [protein, setProtein] = useState('150');
  const [carbs, setCarbs] = useState('250');
  const [fat, setFat] = useState('65');
  const [preferences, setPreferences] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [showAdjust, setShowAdjust] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  useEffect(() => {
    if (!isGenerating) return;
    const interval = window.setInterval(() => setLoadingStep((step) => (step + 1) % loadingMessages.length), 15000);
    return () => window.clearInterval(interval);
  }, [isGenerating]);

  const waitForJob = async (jobId: number, kind: 'generate' | 'adjust') => {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    while (Date.now() < deadline) {
      await wait(POLL_INTERVAL_MS);
      const job = await nutritionApi.getJob(jobId);
      if (job.status === 'done') return;
      if (job.status === 'failed') throw new Error(job.error || `Não foi possível ${kind === 'generate' ? 'criar' : 'ajustar'} o plano`);
    }
    throw new Error('Está demorando mais que o esperado. Tente novamente em instantes.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (method === 'manual') {
      await createPlan({
        name,
        calories_target: Number(calories),
        protein_target: Number(protein),
        carbs_target: Number(carbs),
        fat_target: Number(fat),
      });
      setShowForm(false);
      return;
    }
    setIsGenerating(true);
    try {
      const job = await nutritionApi.createAutomatic({ preferences });
      await waitForJob(job.id, 'generate');
      await fetchPlans();
      setShowForm(false);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsGenerating(false);
    }
  };

  const activate = async (id: number) => {
    await nutritionApi.activate(id);
    await fetchPlans();
  };

  const submitAdjust = async () => {
    if (!activePlan || !instructions.trim() || isAdjusting) return;
    setIsAdjusting(true);
    setAdjustError(null);
    try {
      const job = await nutritionApi.adjust(activePlan.id, instructions.trim());
      await waitForJob(job.id, 'adjust');
      await fetchPlans();
      setShowAdjust(false);
      setInstructions('');
    } catch (requestError) {
      setAdjustError(getErrorMessage(requestError));
    } finally {
      setIsAdjusting(false);
    }
  };

  const field = 'h-[52px] w-full rounded-md border-2 border-transparent bg-surface-2 px-4 text-base text-fg placeholder:text-dim focus:border-brand-fg focus:outline-none';
  const others = plans.filter((p) => !p.active);
  const active = plans.find((p) => p.active);
  const macroCols = (p: { protein_target: number; carbs_target: number; fat_target: number }) => [
    { label: 'Proteína', v: p.protein_target, c: 'text-violet' },
    { label: 'Carbo', v: p.carbs_target, c: 'text-sun' },
    { label: 'Gordura', v: p.fat_target, c: 'text-brand-fg' },
  ];

  return (
    <>
      <Header
        title="Plano"
        showBack
        rightAction={
          <Button size="md" variant={showForm ? 'secondary' : 'primary'} onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancelar' : <><PlusIcon className="h-5 w-5" /> Novo</>}
          </Button>
        }
      />
      <div className="space-y-[14px] px-5 pb-24 pt-2">
        {showForm && (
          <Card className="enter space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1" role="tablist">
              {(['automatic', 'manual'] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={method === m} onClick={() => setMethod(m)}
                  className={`press min-h-[48px] rounded-sm text-base font-semibold ${method === m ? 'bg-teal text-on-teal' : 'text-muted'}`}>
                  {m === 'automatic' ? 'Automático' : 'Manual'}
                </button>
              ))}
            </div>

            {error && <div role="alert" className="rounded-md bg-danger/15 p-3 text-[15px] text-danger">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
              {method === 'automatic' ? (
                <>
                  <p className="text-[15px] leading-[1.45] text-muted">
                    O assistente calcula as metas e monta o cardápio com seu peso, altura, idade, objetivo e plano de treino atual.
                  </p>
                  <label className="block text-[15px] font-semibold text-fg">Preferências <span className="font-normal text-dim">(opcional)</span>
                    <textarea
                      value={preferences}
                      onChange={(e) => setPreferences(e.target.value)}
                      rows={3}
                      maxLength={1000}
                      placeholder="Ex.: não como laticínios, gosto de frango"
                      className="mt-2 w-full resize-none rounded-md border-2 border-transparent bg-surface-2 px-4 py-3 text-base font-normal text-fg placeholder:text-dim focus:border-brand-fg focus:outline-none"
                    />
                  </label>
                  <Button type="submit" size="lg" fullWidth isLoading={isGenerating}>Gerar plano com IA</Button>
                </>
              ) : (
                <>
                  <label className="block text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Nome
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Ganho de massa" required className={`mt-2 normal-case tracking-normal font-normal ${field}`} />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Calorias (kcal)', value: calories, setter: setCalories, color: 'text-teal' },
                      { label: 'Proteína (g)', value: protein, setter: setProtein, color: 'text-violet' },
                      { label: 'Carboidrato (g)', value: carbs, setter: setCarbs, color: 'text-sun' },
                      { label: 'Gordura (g)', value: fat, setter: setFat, color: 'text-brand-fg' },
                    ].map((f) => (
                      <label key={f.label} className={`block text-[13px] font-semibold ${f.color}`}>{f.label}
                        <input type="number" inputMode="numeric" value={f.value} min={0} onChange={(e) => f.setter(e.target.value)} className={`mt-2 text-center font-sans text-base font-semibold ${field}`} />
                      </label>
                    ))}
                  </div>
                  <Button type="submit" size="lg" fullWidth isLoading={isLoading}>Criar plano</Button>
                </>
              )}
            </form>
          </Card>
        )}

        {isLoading && plans.length === 0 ? (
          <><SkeletonCard rows={2} /><SkeletonCard rows={3} /></>
        ) : loadError && plans.length === 0 ? (
          <ErrorState message={loadError} onRetry={() => void fetchPlans()} />
        ) : plans.length === 0 && !showForm ? (
          <Card className="enter">
            <EmptyState icon={<LeafIcon />} title="Nenhum plano ainda" text="Gere um plano com IA ou monte um manual. Ele define a meta do anel de calorias." actionLabel="Criar plano" onAction={() => setShowForm(true)} />
          </Card>
        ) : (
          <>
            {active && (
              <div className="enter" style={{ '--i': 0 } as React.CSSProperties}>
                <Card tint="teal" className="!p-5">
                  <div className="flex items-center justify-between gap-3">
                    <Chip tone="teal">Plano ativo</Chip>
                    <Button size="sm" variant="secondary" onClick={() => setShowAdjust(true)}>Ajustar com IA</Button>
                  </div>
                  <h2 className="mt-3 text-[17px] font-bold leading-[1.3] text-fg">{active.name}</h2>
                  <p className="num mt-1 text-[38px] leading-[1.05] text-teal">
                    <CountUp value={Math.round(active.calories_target)} /><span className="font-sans text-[15px] font-medium text-muted"> kcal por dia</span>
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {macroCols(active).map((m) => (
                      <div key={m.label} className="min-w-0 rounded-md bg-surface-2 px-3 py-3">
                        <p className="truncate text-[13px] text-muted">{m.label}</p>
                        <p className={`num text-[24px] leading-[1.1] ${m.c}`}>{Math.round(m.v)}<span className="font-sans text-[13px] font-medium text-muted"> g</span></p>
                      </div>
                    ))}
                  </div>
                  {active.rationale && <p className="mt-4 text-[15px] leading-[1.45] text-muted">{active.rationale}</p>}
                </Card>
              </div>
            )}

            {active && (active.meals ?? []).length > 0 && (
              <>
                <SectionTitle>Cardápio do dia</SectionTitle>
                {(active.meals ?? []).map((meal, i) => {
                  const kcal = (meal.items ?? []).reduce((a, it) => a + it.calories, 0);
                  return (
                    <div key={meal.id} className="enter" style={{ '--i': i + 1 } as React.CSSProperties}>
                      <Card>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-[17px] font-bold text-fg">{MEAL_TYPE_LABELS[meal.meal_type] ?? meal.name}</h3>
                            {meal.suggested_at && <p className="text-[13px] text-dim">{meal.suggested_at}</p>}
                          </div>
                          <p className="num text-[24px] leading-[1.1] text-fg">{Math.round(kcal)}<span className="font-sans text-[13px] font-medium text-muted"> kcal</span></p>
                        </div>
                        <ul className="mt-2">
                          {(meal.items ?? []).map((it) => (
                            <li key={it.id} className="flex min-h-[56px] items-center justify-between gap-3">
                              <p className="min-w-0 flex-1 text-base font-semibold text-fg">{it.food_name}</p>
                              <p className="shrink-0 text-right text-[15px] text-muted"><span className="num text-[18px] text-fg">{Math.round(it.quantity_g)}</span> g</p>
                            </li>
                          ))}
                        </ul>
                      </Card>
                    </div>
                  );
                })}
              </>
            )}

            {others.length > 0 && (
              <>
                <SectionTitle>Outros planos</SectionTitle>
                {others.map((plan) => (
                  <Card key={plan.id}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-bold text-fg">{plan.name}</p>
                        <p className="mt-0.5 text-[15px] text-muted"><span className="num text-[18px] text-teal">{plan.calories_target}</span> kcal por dia</p>
                      </div>
                      <Button size="md" variant="secondary" onClick={() => activate(plan.id)}>Ativar</Button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {macroCols(plan).map((m) => <Chip key={m.label} tone="neutral">{m.label} {Math.round(m.v)} g</Chip>)}
                      {plan.creation_method === 'automatic' && <Chip tone="neutral">IA</Chip>}
                    </div>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {isGenerating && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm text-center">
            <div className="relative mx-auto h-28 w-28">
              <div className="absolute inset-0 animate-ping rounded-full bg-teal-soft" />
              <img src="/mob-icon.png" alt="" className="relative h-28 w-28 animate-pulse rounded-lg object-cover shadow-sheet" />
            </div>
            <h2 className="num mt-6 text-[34px] leading-[1.02] text-fg">Criando seu plano</h2>
            <p className="mt-2 text-[17px] font-semibold text-teal">{loadingMessages[loadingStep]}</p>
            <p className="mt-4 text-[15px] text-muted">Isso pode levar alguns minutos.</p>
          </div>
        </div>
      )}

      {showAdjust && activePlan && (
        <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={() => !isAdjusting && setShowAdjust(false)}>
          <div className="sheet-in flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-xl bg-surface p-5 pb-safe shadow-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 className="num text-[28px] leading-[1.05] text-fg">Ajustar plano</h3>
            <p className="mt-1 text-[15px] text-muted">Diga o que mudar. O histórico fica como está.</p>
            {adjustError && <div role="alert" className="mt-3 rounded-md bg-danger/15 p-3 text-[15px] text-danger">{adjustError}</div>}
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={isAdjusting}
              placeholder="Descreva o que quer mudar"
              className="mt-3 w-full resize-none rounded-md border-2 border-transparent bg-surface-2 px-4 py-3 text-base text-fg placeholder:text-dim focus:border-brand-fg focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {ADJUST_EXAMPLES.map((example) => (
                <button key={example} type="button" disabled={isAdjusting} onClick={() => setInstructions(example)} className="press min-h-[44px] rounded-chip bg-surface-2 px-4 text-[15px] text-muted disabled:opacity-[.45]">
                  {example}
                </button>
              ))}
            </div>
            <Button fullWidth size="lg" className="mt-4" isLoading={isAdjusting} onClick={submitAdjust} disabled={!instructions.trim()}>
              {isAdjusting ? 'Ajustando o plano' : 'Aplicar ajuste'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
