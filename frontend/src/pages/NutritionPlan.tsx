import { useEffect, useState } from 'react';
import { useNutritionStore } from '../stores/useNutritionStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { nutritionApi } from '../api/nutrition';
import { getErrorMessage } from '../api/client';
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
  const { plans, activePlan, isLoading, fetchPlans, createPlan } = useNutritionStore();

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

  return (
    <>
      <Header
        title="Planos Alimentares"
        showBack
        rightAction={
 <div className="flex gap-2">
            {activePlan && (
              <Button size="sm" variant="secondary" onClick={() => setShowAdjust(true)}>
                Ajustar
              </Button>
            )}
            <Button size="sm" onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancelar' : '+ Novo'}
            </Button>
          </div>
        }
      />
 <div className="px-4 py-4 pb-24 space-y-4">
        {showForm && (
 <Card className="space-y-4">
 <div className="grid grid-cols-2 rounded-lg bg-bg p-1">
 <button type="button" onClick={() => setMethod('automatic')} className={`rounded-md py-2.5 text-sm font-semibold ${method === 'automatic' ? 'bg-brand text-white' : 'text-dim'}`}>Automático</button>
 <button type="button" onClick={() => setMethod('manual')} className={`rounded-md py-2.5 text-sm font-semibold ${method === 'manual' ? 'bg-brand text-white' : 'text-dim'}`}>Manual</button>
            </div>

 {error && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}

 <form onSubmit={handleSubmit} className="space-y-3">
              {method === 'automatic' ? (
                <>
 <p className="text-xs leading-relaxed text-dim">
                    O assistente calcula as metas e monta um cardápio a partir do seu peso, altura, idade, objetivo
                    e do seu plano de treino atual.
                  </p>
 <label className="block text-sm text-fg">Preferências <span className="text-dim">(opcional)</span>
                    <textarea
                      value={preferences}
                      onChange={(e) => setPreferences(e.target.value)}
                      rows={3}
                      maxLength={1000}
                      placeholder="Ex: não como laticínios, gosto de frango, evito peixe..."
 className="mt-1.5 w-full resize-none rounded-md border border-line bg-surface-2 px-3 py-2.5 text-fg focus:outline-none text-sm"
                    />
                  </label>
                  <Button type="submit" fullWidth isLoading={isGenerating}>
                    Gerar plano com IA
                  </Button>
                </>
              ) : (
                <>
                  <div>
 <label className="block text-xs text-muted uppercase tracking-wide mb-1.5">Nome</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Ganho de massa"
                      required
 className="w-full bg-surface-2 border border-line rounded-md px-3 py-2.5 text-fg placeholder-dim focus:outline-none text-sm"
                    />
                  </div>
 <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Calorias (kcal)', value: calories, setter: setCalories, color: 'text-brand-fg' },
                      { label: 'Proteína (g)', value: protein, setter: setProtein, color: 'text-teal' },
                      { label: 'Carboidratos (g)', value: carbs, setter: setCarbs, color: 'text-sun' },
                      { label: 'Gordura (g)', value: fat, setter: setFat, color: 'text-danger' },
                    ].map((field) => (
                      <div key={field.label}>
 <label className={`block text-xs ${field.color} mb-1.5`}>{field.label}</label>
                        <input
                          type="number"
                          value={field.value}
                          min={0}
                          onChange={(e) => field.setter(e.target.value)}
 className="w-full bg-surface-2 border border-line rounded-md px-3 py-2.5 text-fg text-center focus:outline-none text-sm"
                        />
                      </div>
                    ))}
                  </div>
                  <Button type="submit" fullWidth isLoading={isLoading}>
                    Criar Plano
                  </Button>
                </>
              )}
            </form>
          </Card>
        )}

        {plans.length === 0 && !showForm ? (
 <Card className="text-center py-8">
 <p className="text-muted text-sm">Nenhum plano criado ainda</p>
          </Card>
        ) : (
 <div className="space-y-3">
            {plans.map((plan) => (
 <Card key={plan.id} className={plan.active ? 'border-brand' : ''}>
 <div className="flex items-start justify-between">
                  <div>
 <div className="flex items-center gap-2 mb-1">
 <p className="font-semibold text-fg">{plan.name}</p>
 {plan.active && <span className="text-xs bg-brand-soft text-brand-fg px-2 py-0.5 rounded-full">Ativo</span>}
 {plan.creation_method === 'automatic' && <span className="text-xs bg-surface-2 text-muted px-2 py-0.5 rounded-full">IA</span>}
                    </div>
 <p className="text-sm text-muted">{plan.calories_target} kcal/dia</p>
                  </div>
                  {!plan.active && (
                    <Button size="sm" variant="secondary" onClick={() => activate(plan.id)}>Ativar</Button>
                  )}
                </div>
 <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-line">
 <div className="text-center"><p className="text-sm font-semibold text-teal">{plan.protein_target}g</p><p className="text-xs text-dim">proteína</p></div>
 <div className="text-center"><p className="text-sm font-semibold text-sun">{plan.carbs_target}g</p><p className="text-xs text-dim">carbs</p></div>
 <div className="text-center"><p className="text-sm font-semibold text-danger">{plan.fat_target}g</p><p className="text-xs text-dim">gordura</p></div>
                </div>

                {plan.active && plan.rationale && (
 <p className="mt-3 pt-3 border-t border-line text-xs leading-relaxed text-dim">{plan.rationale}</p>
                )}

                {plan.active && plan.meals && plan.meals.length > 0 && (
 <div className="mt-3 pt-3 border-t border-line space-y-2">
                    {plan.meals.map((meal) => (
                      <div key={meal.id}>
 <p className="text-xs font-semibold text-fg">
 {MEAL_TYPE_LABELS[meal.meal_type]} {meal.suggested_at && <span className="font-normal text-dim">· {meal.suggested_at}</span>}
                        </p>
 <p className="text-xs text-dim">{meal.items.map((item) => `${item.food_name} (${item.quantity_g}g)`).join(', ')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {isGenerating && (
 <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 px-6 backdrop-blur-sm">
 <div className="w-full max-w-sm text-center">
 <div className="relative mx-auto h-28 w-28">
 <div className="absolute inset-0 animate-ping rounded-full bg-brand-soft" />
 <img src="/mob-icon.png" alt="" className="relative h-28 w-28 animate-pulse rounded-lg object-cover shadow-2xl" />
            </div>
 <div className="mx-auto mt-7 h-1.5 w-48 overflow-hidden rounded-full bg-surface-2">
 <div className="h-full w-2/3 animate-pulse rounded-full bg-brand" />
            </div>
 <h2 className="mt-5 text-xl font-black text-fg">Criando seu plano</h2>
 <p className="mt-2 text-sm text-brand-fg">{loadingMessages[loadingStep]}</p>
 <p className="mt-4 text-xs text-dim">Isso pode levar alguns minutos.</p>
          </div>
        </div>
      )}

      {showAdjust && activePlan && (
 <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={() => !isAdjusting && setShowAdjust(false)}>
 <div className="flex max-h-[85vh] w-full flex-col rounded-t-xl bg-surface shadow-sheet sheet-in p-5 pb-safe" onClick={(e) => e.stopPropagation()}>
 <h3 className="text-lg font-bold text-fg">Ajustar plano com IA</h3>
 {adjustError && <div className="mt-3 rounded-md bg-danger-soft p-3 text-sm text-danger">{adjustError}</div>}
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={isAdjusting}
              placeholder="Descreva o que quer mudar..."
 className="mt-3 w-full resize-none rounded-lg shadow-card bg-bg px-4 py-3 text-sm text-fg placeholder-dim focus:outline-none"
            />
 <div className="mt-2 flex flex-wrap gap-2">
              {ADJUST_EXAMPLES.map((example) => (
 <button key={example} type="button" disabled={isAdjusting} onClick={() => setInstructions(example)} className="rounded-full border border-line bg-bg px-3 py-1.5 text-xs text-muted">
                  {example}
                </button>
              ))}
            </div>
 <Button fullWidth size="lg" className="mt-4" isLoading={isAdjusting} onClick={submitAdjust} disabled={!instructions.trim()}>
              {isAdjusting ? 'Ajustando o plano...' : 'Aplicar ajuste'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
