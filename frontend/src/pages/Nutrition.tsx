import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNutritionStore } from '../stores/useNutritionStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { MacroProgress } from '../components/Chart';
import { OriginBadge } from '../components/OriginBadge';
import { EditFoodLogModal } from '../components/EditFoodLogModal';
import { nutritionApi } from '../api/nutrition';
import { getErrorMessage } from '../api/client';
import { todayLocalDate } from '../lib/date';
import { MEAL_TYPE_LABELS, type FoodLog, type MealType, type NutritionSuggestion, type UpdateFoodLogInput } from '../types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function NutritionPage() {
  const navigate = useNavigate();
  const { todayLogs, activePlan, isLoading, fetchTodayLogs, fetchPlans, logFood, deleteLog } = useNutritionStore();
  const [editingLog, setEditingLog] = useState<FoodLog | null>(null);
  // The suggestion is for the rest of the day as a whole (the backend has no
  // per-meal endpoint) — tapping the icon on any meal opens the same modal
  // with the same "rest of the day" answer, whichever meal it was tapped on.
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<NutritionSuggestion | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  useEffect(() => {
    // A date-less key is the same cache entry every day of the app's life —
    // offline, it would keep serving yesterday's snapshot forever instead of
    // "no records yet" for a day that hasn't been read before. See
    // useNutritionStore's `logsKey`.
    fetchTodayLogs(todayLocalDate());
    fetchPlans();
  }, [fetchTodayLogs, fetchPlans]);

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

  const openSuggestion = async () => {
    setSuggestionOpen(true);
    setIsSuggesting(true);
    setSuggestionError(null);
    try {
      setSuggestion(await nutritionApi.suggestion());
    } catch (requestError) {
      setSuggestionError(getErrorMessage(requestError));
    } finally {
      setIsSuggesting(false);
    }
  };

  const logPlannedItem = async (mealType: MealType, item: { food_name: string; quantity_g: number; calories: number; protein_g: number; carbs_g: number; fat_g: number }) => {
    await logFood({
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
      date: todayLocalDate(),
    });
  };

  const handleSaveEdit = async (id: number, input: UpdateFoodLogInput) => {
    // The diary only ever shows today's logs, so the record being edited is
    // always dated today — matching the key fetchTodayLogs(todayLocalDate())
    // populated at mount, so the offline snapshot actually gets patched
    // instead of a second, never-read cache entry.
    await useNutritionStore.getState().updateLog(id, input, todayLocalDate());
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

        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
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
                      {activePlan && (
                        <button
                          type="button"
                          onClick={openSuggestion}
                          aria-label="Sugestão do plano para o resto do dia"
                          className="text-zinc-500 hover:text-primary-400"
                        >
                          💡
                        </button>
                      )}
                    </h3>
                    {mealCal > 0 && <span className="text-xs text-zinc-500">{Math.round(mealCal)} kcal</span>}
                  </div>

                  {plannedMeal && (
                    <Card className="mb-2 space-y-2 border-zinc-800/60 bg-zinc-950/60">
                      <p className="text-xs uppercase tracking-wide text-zinc-600">Sugestão do plano</p>
                      {plannedMeal.items.map((item, index) => (
                        <div key={index} className="flex items-center justify-between gap-2">
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
                    </Card>
                  )}

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
                                onClick={() => deleteLog(log.id)}
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
        )}
      </div>

      {editingLog && (
        <EditFoodLogModal log={editingLog} onClose={() => setEditingLog(null)} onSave={handleSaveEdit} />
      )}

      {suggestionOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end bg-black/80 backdrop-blur-sm"
          onClick={() => setSuggestionOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-3xl bg-zinc-900 p-5 pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white">O que comer no resto do dia?</h3>
            {isSuggesting && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {suggestionError && <p className="mt-3 text-xs text-red-400">{suggestionError}</p>}
            {!isSuggesting && suggestion && (
              <ul className="mt-3 space-y-2">
                {suggestion.suggestions.map((item, index) => (
                  <li key={index} className="rounded-xl bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
