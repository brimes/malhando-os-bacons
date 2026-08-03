import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { MacroProgress } from '../components/Chart';
import { OriginBadge } from '../components/OriginBadge';
import { EditFoodLogModal } from '../components/EditFoodLogModal';
import { todayLocalDate } from '../lib/date';
import { dateKey, createFoodLog, deleteFoodLog, foodLogsCache, updateFoodLog } from '../lib/local/repo/foodLogs';
import { nutritionPlansCache } from '../lib/local/repo/nutritionPlans';
import { useLocalAll } from '../lib/local/useLocal';
import { MEAL_TYPE_LABELS, type FoodLog, type MealType, type UpdateFoodLogInput } from '../types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function NutritionPage() {
  const navigate = useNavigate();
  const [editingLog, setEditingLog] = useState<FoodLog | null>(null);
  // Which meal's planned-menu modal is open, if any. The menu itself comes
  // straight from `activePlan.meals` — already loaded with the plan — so
  // opening this never touches the backend.
  const [menuMeal, setMenuMeal] = useState<MealType | null>(null);

  // Local-first: both come straight from IndexedDB (loaded during boot — see
  // `offlineBoot.ts`) and re-render on their own the moment a write, a pull
  // or the outbox change them. No `isLoading`, no network call on mount —
  // the screen never waits for one to have something to draw.
  const today = todayLocalDate();
  const allLogs = useLocalAll(foodLogsCache);
  const todayLogs = useMemo(() => allLogs.filter((log) => dateKey(log.date) === today), [allLogs, today]);
  const plans = useLocalAll(nutritionPlansCache);
  const activePlan = useMemo(() => plans.find((plan) => plan.active) ?? null, [plans]);

  const totals = todayLogs.reduce(
    (acc, log) => ({
      calories: acc.calories + log.calories,
      protein: acc.protein + log.protein_g,
      carbs: acc.carbs + log.carbs_g,
      fat: acc.fat + log.fat_g,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const byMeal = todayLogs.reduce<Record<string, FoodLog[]>>((acc, log) => {
    (acc[log.meal_type] ??= []).push(log);
    return acc;
  }, {});

  const logPlannedItem = async (mealType: MealType, item: { food_name: string; quantity_g: number; calories: number; protein_g: number; carbs_g: number; fat_g: number }) => {
    await createFoodLog({
      food_name: item.food_name,
      quantity_g: item.quantity_g,
      meal_type: mealType,
      origin: 'plan',
      calories: item.calories,
      protein_g: item.protein_g,
      carbs_g: item.carbs_g,
      fat_g: item.fat_g,
      // Without this the server falls back to its own time.Now() — offline,
      // that means whatever date the queue drains on, not the day the person
      // actually tapped "Já comi".
      date: today,
    });
  };

  const handleSaveEdit = async (id: number, input: UpdateFoodLogInput) => {
    await updateFoodLog(id, input);
  };

  return (
    <>
      <Header
        title="Nutrição"
        rightAction={
          <Button size="sm" onClick={() => navigate('/nutrition/log')}>
            + Log
          </Button>
        }
      />
      <div className="px-4 py-4 pb-24 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/nutrition/photo/plate')} className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-3 text-center">
            <span className="block text-xl">🍽️</span>
            <span className="text-xs font-medium text-zinc-300">Foto do prato</span>
          </button>
          <button onClick={() => navigate('/nutrition/photo/label')} className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-3 text-center">
            <span className="block text-xl">🏷️</span>
            <span className="text-xs font-medium text-zinc-300">Foto do rótulo</span>
          </button>
        </div>

        <button onClick={() => navigate('/nutrition/cheat-day')} className="flex w-full items-center justify-between rounded-2xl border border-amber-900 bg-amber-950/30 px-4 py-3 text-left">
          <div>
            <p className="text-sm font-semibold text-amber-300">🍕 Dia do lixo</p>
            <p className="text-xs text-amber-200/70">Vai exagerar hoje? Fale comigo antes.</p>
          </div>
          <span className="text-xl text-amber-400">›</span>
        </button>

        <button onClick={() => navigate('/nutrition/history')} className="flex w-full items-center justify-between rounded-2xl border border-primary-900 bg-primary-950/50 px-4 py-3 text-left">
          <div><p className="text-sm font-semibold text-primary-300">Calendário de calorias</p><p className="text-xs text-zinc-500">Acompanhe o consumo de cada dia</p></div>
          <span className="text-xl text-primary-400">›</span>
        </button>

        {activePlan ? (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide">Plano ativo</p>
                <p className="font-semibold text-white">{activePlan.name}</p>
              </div>
              <button onClick={() => navigate('/nutrition/plan')} className="text-primary-400 text-xs">
                Gerenciar
              </button>
            </div>
            <MacroProgress
              calories={totals.calories}
              caloriesTarget={activePlan.calories_target}
              protein={totals.protein}
              proteinTarget={activePlan.protein_target}
              carbs={totals.carbs}
              carbsTarget={activePlan.carbs_target}
              fat={totals.fat}
              fatTarget={activePlan.fat_target}
            />
          </Card>
        ) : (
          <Card className="text-center py-4">
            <p className="text-zinc-400 text-sm mb-3">Nenhum plano alimentar ativo</p>
            <Button size="sm" onClick={() => navigate('/nutrition/plan')}>
              Criar plano
            </Button>
          </Card>
        )}

        <div className="space-y-4">
          {MEAL_ORDER.map((meal) => {
            const logs = byMeal[meal] ?? [];
            const mealCal = logs.reduce((s, l) => s + l.calories, 0);
            const plannedMeal = activePlan?.meals?.find((m) => m.meal_type === meal);

            return (
              <div key={meal}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="flex items-center gap-1.5 font-semibold text-white text-sm">
                    {MEAL_TYPE_LABELS[meal]}
                    {plannedMeal?.suggested_at && <span className="ml-2 text-xs font-normal text-zinc-500">{plannedMeal.suggested_at}</span>}
                    {/* Only when there is something to show — a meal with no
                        planned items would open an empty modal. */}
                    {plannedMeal && plannedMeal.items.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setMenuMeal(meal)}
                        aria-label={`Sugestão do plano para ${MEAL_TYPE_LABELS[meal].toLowerCase()}`}
                        className="text-zinc-500 hover:text-primary-400"
                      >
                        💡
                      </button>
                    )}
                  </h3>
                  {mealCal > 0 && <span className="text-xs text-zinc-500">{Math.round(mealCal)} kcal</span>}
                </div>

                {logs.length === 0 ? (
                  <Card className="py-3">
                    <p className="text-sm text-zinc-600 text-center">Nenhum registro</p>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {logs.map((log) => (
                      <Card key={log.id} className="py-3">
                        <div className="flex items-center justify-between">
                          <button className="min-w-0 flex-1 text-left" onClick={() => setEditingLog(log)}>
                            <p className="text-sm font-medium text-white truncate">
                              {log.food_name}
                              <OriginBadge origin={log.origin} />
                            </p>
                            <p className="text-xs text-zinc-500">{log.quantity_g}g</p>
                          </button>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-primary-400">{Math.round(log.calories)} kcal</p>
                              <p className="text-xs text-zinc-500">
                                P:{Math.round(log.protein_g)}g C:{Math.round(log.carbs_g)}g G:{Math.round(log.fat_g)}g
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => deleteFoodLog(log.id)}
                              aria-label="Apagar"
                              className="p-1 text-lg text-zinc-600"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {editingLog && (
        <EditFoodLogModal log={editingLog} onClose={() => setEditingLog(null)} onSave={handleSaveEdit} />
      )}

      {menuMeal && (() => {
        const meal = menuMeal;
        const plannedMeal = activePlan?.meals?.find((m) => m.meal_type === meal);
        return (
          <div
            className="fixed inset-0 z-[100] flex items-end bg-black/80 backdrop-blur-sm"
            onClick={() => setMenuMeal(null)}
          >
            <div
              className="flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-3xl bg-zinc-900 p-5 pb-safe"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-white">Sugestão do plano — {MEAL_TYPE_LABELS[meal]}</h3>
              {plannedMeal?.suggested_at && <p className="mt-1 text-xs text-zinc-500">{plannedMeal.suggested_at}</p>}
              <div className="mt-3 space-y-2">
                {(plannedMeal?.items ?? []).map((item, index) => (
                  <div key={index} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-950 p-3">
                    <p className="text-xs text-zinc-400">{item.food_name} · {item.quantity_g}g</p>
                    <button
                      type="button"
                      onClick={() => logPlannedItem(meal, item)}
                      className="shrink-0 rounded-full bg-zinc-800 px-3 py-1 text-[11px] font-medium text-zinc-300"
                    >
                      Já comi
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
