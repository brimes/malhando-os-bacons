import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNutritionStore } from '../stores/useNutritionStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { MacroProgress } from '../components/Chart';
import { MEAL_TYPE_LABELS, type MealType } from '../types';

export function NutritionPage() {
  const navigate = useNavigate();
  const { todayLogs, activePlan, isLoading, fetchTodayLogs, fetchPlans } = useNutritionStore();

  useEffect(() => {
    fetchTodayLogs();
    fetchPlans();
  }, [fetchTodayLogs, fetchPlans]);

  const totals = todayLogs.reduce(
    (acc, log) => ({
      calories: acc.calories + (log.calories ?? 0),
      protein: acc.protein + (log.protein_g ?? 0),
      carbs: acc.carbs + (log.carbs_g ?? 0),
      fat: acc.fat + (log.fat_g ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const byMeal = todayLogs.reduce<Record<MealType, typeof todayLogs>>((acc, log) => {
    const meal = log.meal_type as MealType;
    if (!acc[meal]) acc[meal] = [];
    acc[meal].push(log);
    return acc;
  }, {} as Record<MealType, typeof todayLogs>);

  const mealOrder: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

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
        <button onClick={() => navigate('/nutrition/history')} className="flex w-full items-center justify-between rounded-2xl border border-primary-900 bg-primary-950/50 px-4 py-3 text-left">
          <div><p className="text-sm font-semibold text-primary-300">Calendário de calorias</p><p className="text-xs text-zinc-500">Acompanhe o consumo de cada dia</p></div>
          <span className="text-xl text-primary-400">›</span>
        </button>
        {/* Macro summary */}
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

        {/* Meals */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {mealOrder.map((meal) => {
              const logs = byMeal[meal] ?? [];
              const mealCal = logs.reduce((s, l) => s + (l.calories ?? 0), 0);

              return (
                <div key={meal}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-white text-sm">{MEAL_TYPE_LABELS[meal]}</h3>
                    {mealCal > 0 && (
                      <span className="text-xs text-zinc-500">{Math.round(mealCal)} kcal</span>
                    )}
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
                            <div>
                              <p className="text-sm font-medium text-white">
                                {log.food_item?.name}
                              </p>
                              <p className="text-xs text-zinc-500">{log.quantity_g}g</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-primary-400">
                                {Math.round(log.calories ?? 0)} kcal
                              </p>
                              <p className="text-xs text-zinc-500">
                                P:{Math.round(log.protein_g ?? 0)}g C:{Math.round(log.carbs_g ?? 0)}g G:{Math.round(log.fat_g ?? 0)}g
                              </p>
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
    </>
  );
}
