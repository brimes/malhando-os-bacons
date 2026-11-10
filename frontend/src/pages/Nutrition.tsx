import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { MacroProgress } from '../components/Chart';
import { OriginBadge } from '../components/OriginBadge';
import { EditFoodLogModal } from '../components/EditFoodLogModal';
import { FoodLogAssistant } from '../components/FoodLogAssistant';
import { RoutinePreviewModal } from '../components/RoutinePreviewModal';
import { todayLocalDate } from '../lib/date';
import { dateKey, createFoodLog, deleteFoodLog, foodLogsCache, updateFoodLog } from '../lib/local/repo/foodLogs';
import { nutritionPlansCache } from '../lib/local/repo/nutritionPlans';
import { useLocalAll } from '../lib/local/useLocal';
import { dismissRoutineDay, useOfflineStore } from '../lib/offline';
import { useNutritionStore } from '../stores/useNutritionStore';
import {
  MEAL_TYPE_LABELS,
  type FoodLog,
  type MealType,
  type NutritionLogDraftEntry,
  type NutritionRoutineMeal,
  type UpdateFoodLogInput,
} from '../types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** "18/09" — o mesmo formato usado pelo resto da tela de nutrição para uma data solta. */
function formatDayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function NutritionPage() {
  const navigate = useNavigate();
  const [editingLog, setEditingLog] = useState<FoodLog | null>(null);
  // Which meal's planned-menu modal is open, if any. The menu itself comes
  // straight from `activePlan.meals` — already loaded with the plan — so
  // opening this never touches the backend.
  const [menuMeal, setMenuMeal] = useState<MealType | null>(null);

  // "Dia normal" (rotina destilada) e "dias esquecidos": contas
  // determinísticas do servidor, cacheáveis como qualquer GET — ver
  // useNutritionStore.fetchRoutine/fetchMissingDays.
  const { routine, missingDays, fetchRoutine, fetchMissingDays, removeMissingDay } = useNutritionStore();
  useEffect(() => {
    fetchRoutine();
    fetchMissingDays();
  }, [fetchRoutine, fetchMissingDays]);

  // Dispensas de "dia esquecido" ("não foi um dia normal") vivem só neste
  // aparelho — sem tabela nova, ver offlineStore.ts.
  const dismissedDays = useOfflineStore((state) => state.dismissedRoutineDays ?? []);
  const visibleMissingDays = useMemo(
    () => missingDays.filter((date) => !dismissedDays.includes(date)),
    [missingDays, dismissedDays]
  );

  // Pré-visualização do dia normal (hoje ou um dia esquecido) antes de virar
  // registro — mesmo modal para os dois, só a data/rótulo mudam.
  const [preview, setPreview] = useState<{ date: string; label: string } | null>(null);

  // "Extrapolei hoje": abre o assistente de conversa já existente para
  // descrever só o excesso; ao terminar, oferece (nunca cria sozinha) o
  // treino de compensação do dia do lixo.
  const [excessMode, setExcessMode] = useState(false);
  const [compensationOffer, setCompensationOffer] = useState<string | null>(null);

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

  // Grava um food_log por item, pelo caminho normal (createFoodLog): funciona
  // offline e entra na fila igual a qualquer registro. `origin: 'routine'`
  // marca que o número é a estimativa da rotina, não uma medição do dia.
  const logRoutineDay = async (date: string, meals: NutritionRoutineMeal[]) => {
    for (const meal of meals) {
      for (const item of meal.items) {
        await createFoodLog({
          food_item_id: item.food_item_id,
          food_name: item.food_name,
          quantity_g: item.quantity_g,
          meal_type: meal.meal_type,
          date,
          origin: 'routine',
          calories: item.calories,
          protein_g: item.protein_g,
          carbs_g: item.carbs_g,
          fat_g: item.fat_g,
        });
      }
    }
  };

  const confirmPreview = async (meals: NutritionRoutineMeal[]) => {
    if (!preview) return;
    await logRoutineDay(preview.date, meals);
    if (preview.date !== today) removeMissingDay(preview.date);
  };

  const openTodayPreview = () => setPreview({ date: today, label: 'hoje' });
  const openMissingDayPreview = (date: string) => setPreview({ date, label: formatDayLabel(date) });

  const dismissMissingDay = (date: string) => {
    dismissRoutineDay(date);
    removeMissingDay(date);
  };

  // "Extrapolei hoje": se o dia ainda estiver vazio, registra a rotina antes
  // de abrir a conversa — decisão do dono: oferecer a compensação, nunca
  // montá-la sozinha, então isso só acontece depois que a pessoa registrar o
  // excesso e escolher.
  const startExcessFlow = async () => {
    if (todayLogs.length === 0 && routine?.enough) {
      await logRoutineDay(today, routine.meals);
    }
    setExcessMode(true);
  };

  const registrarExcesso = async (entries: NutritionLogDraftEntry[], descricao: string) => {
    for (const entry of entries) {
      await createFoodLog({
        food_name: entry.food_name,
        meal_type: entry.meal_type,
        quantity_g: entry.quantity_g,
        date: entry.date,
        origin: 'assistant',
        calories: entry.calories,
        protein_g: entry.protein_g,
        carbs_g: entry.carbs_g,
        fat_g: entry.fat_g,
      });
    }
    setExcessMode(false);
    setCompensationOffer(descricao.trim() || 'Exagerei hoje.');
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
 <button onClick={() => navigate('/nutrition/photo/plate')} className="rounded-lg shadow-card bg-surface px-3 py-3 text-center">
 <span className="block text-xl">🍽️</span>
 <span className="text-xs font-medium text-fg">Foto do prato</span>
          </button>
 <button onClick={() => navigate('/nutrition/photo/label')} className="rounded-lg shadow-card bg-surface px-3 py-3 text-center">
 <span className="block text-xl">🏷️</span>
 <span className="text-xs font-medium text-fg">Foto do rótulo</span>
          </button>
        </div>

        {routine?.enough && todayLogs.length === 0 && (
 <Card className="border-brand bg-brand-soft">
 <p className="text-sm font-semibold text-fg">Foi um dia normal?</p>
 <p className="mt-1 text-xs leading-relaxed text-muted">
              Baseado nos últimos {routine.based_on_days} dias, dá para registrar hoje com um toque.
            </p>
 <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={openTodayPreview}>Foi um dia normal</Button>
              <Button size="sm" variant="secondary" onClick={() => void startExcessFlow()}>Extrapolei hoje</Button>
            </div>
          </Card>
        )}

        {compensationOffer && (
 <Card className=" bg-sun-soft">
 <p className="text-sm font-semibold text-sun">Quer montar a compensação?</p>
 <p className="mt-1 text-xs leading-relaxed text-sun">
              O excesso já está registrado. Posso montar um ajuste no treino para compensar — só se você quiser.
            </p>
 <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  const mensagem = compensationOffer;
                  setCompensationOffer(null);
                  navigate('/nutrition/cheat-day', { state: { initialMessage: mensagem } });
                }}
              >
                Montar compensação
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setCompensationOffer(null)}>Agora não</Button>
            </div>
          </Card>
        )}

        {routine && (routine.enough ? visibleMissingDays.length > 0 : missingDays.length > 0) && (
          <Card>
 <p className="text-sm font-semibold text-fg">Dias esquecidos</p>
            {routine.enough ? (
              <>
 <p className="mt-1 text-xs text-dim">Foi parecido com o normal? Confirme em um toque.</p>
 <div className="mt-3 space-y-2">
                  {visibleMissingDays.map((date) => (
 <div key={date} className="flex items-center justify-between gap-2 rounded-md bg-bg p-3">
 <p className="text-sm text-fg">{formatDayLabel(date)}</p>
 <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => openMissingDayPreview(date)}
 className="rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => dismissMissingDay(date)}
 className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted"
                        >
                          Não foi normal
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
 <p className="mt-1 text-xs leading-relaxed text-dim">
                Registre uns dias normais para o MOB aprender sua rotina — sem ela não dá para propor o que você
                costuma comer nesses dias.
              </p>
            )}
          </Card>
        )}

 <button onClick={() => navigate('/nutrition/cheat-day')} className="flex w-full items-center justify-between rounded-lg bg-sun-soft px-4 py-3 text-left">
          <div>
 <p className="text-sm font-semibold text-sun">🍕 Dia do lixo</p>
 <p className="text-xs text-sun">Vai exagerar hoje? Fale comigo antes.</p>
          </div>
 <span className="text-xl text-sun">›</span>
        </button>

 <button onClick={() => navigate('/nutrition/history')} className="flex w-full items-center justify-between rounded-lg bg-brand-soft px-4 py-3 text-left">
 <div><p className="text-sm font-semibold text-brand-fg">Calendário de calorias</p><p className="text-xs text-dim">Acompanhe o consumo de cada dia</p></div>
 <span className="text-xl text-brand-fg">›</span>
        </button>

        {activePlan ? (
          <Card>
 <div className="flex items-center justify-between mb-4">
              <div>
 <p className="text-xs text-dim uppercase tracking-wide">Plano ativo</p>
 <p className="font-semibold text-fg">{activePlan.name}</p>
              </div>
 <button onClick={() => navigate('/nutrition/plan')} className="text-brand-fg text-xs">
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
 <p className="text-muted text-sm mb-3">Nenhum plano alimentar ativo</p>
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
 <h3 className="flex items-center gap-1.5 font-semibold text-fg text-sm">
                    {MEAL_TYPE_LABELS[meal]}
 {plannedMeal?.suggested_at && <span className="ml-2 text-xs font-normal text-dim">{plannedMeal.suggested_at}</span>}
                    {/* Only when there is something to show — a meal with no
                        planned items would open an empty modal. */}
                    {plannedMeal && plannedMeal.items.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setMenuMeal(meal)}
                        aria-label={`Sugestão do plano para ${MEAL_TYPE_LABELS[meal].toLowerCase()}`}
 className="text-dim hover:text-brand-fg"
                      >
                        💡
                      </button>
                    )}
                  </h3>
 {mealCal > 0 && <span className="text-xs text-dim">{Math.round(mealCal)} kcal</span>}
                </div>

                {logs.length === 0 ? (
 <Card className="py-3">
 <p className="text-sm text-dim text-center">Nenhum registro</p>
                  </Card>
                ) : (
 <div className="space-y-2">
                    {logs.map((log) => (
 <Card key={log.id} className="py-3">
 <div className="flex items-center justify-between">
 <button className="min-w-0 flex-1 text-left" onClick={() => setEditingLog(log)}>
 <p className="text-sm font-medium text-fg truncate">
                              {log.food_name}
                              <OriginBadge origin={log.origin} />
                            </p>
 <p className="text-xs text-dim">{log.quantity_g}g</p>
                          </button>
 <div className="flex items-center gap-3">
 <div className="text-right">
 <p className="text-sm font-semibold text-brand-fg">{Math.round(log.calories)} kcal</p>
 <p className="text-xs text-dim">
                                P:{Math.round(log.protein_g)}g C:{Math.round(log.carbs_g)}g G:{Math.round(log.fat_g)}g
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => deleteFoodLog(log.id)}
                              aria-label="Apagar"
 className="p-1 text-lg text-dim"
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
        <EditFoodLogModal log={editingLog} onClose={() => setEditingLog(null)} onSave={handleSaveEdit} onDelete={deleteFoodLog} />
      )}

      {menuMeal && (() => {
        const meal = menuMeal;
        const plannedMeal = activePlan?.meals?.find((m) => m.meal_type === meal);
        return (
          <div
 className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm"
            onClick={() => setMenuMeal(null)}
          >
            <div
 className="flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-xl bg-surface shadow-sheet sheet-in p-5 pb-safe"
              onClick={(e) => e.stopPropagation()}
            >
 <h3 className="text-lg font-bold text-fg">Sugestão do plano — {MEAL_TYPE_LABELS[meal]}</h3>
 {plannedMeal?.suggested_at && <p className="mt-1 text-xs text-dim">{plannedMeal.suggested_at}</p>}
 <div className="mt-3 space-y-2">
                {(plannedMeal?.items ?? []).map((item, index) => (
 <div key={index} className="flex items-center justify-between gap-2 rounded-md bg-bg p-3">
 <p className="text-xs text-muted">{item.food_name} · {item.quantity_g}g</p>
                    <button
                      type="button"
                      onClick={() => logPlannedItem(meal, item)}
 className="shrink-0 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-fg"
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

      {preview && routine && (
        <RoutinePreviewModal
          dateLabel={preview.label}
          meals={routine.meals}
          onClose={() => setPreview(null)}
          onConfirm={confirmPreview}
        />
      )}

      {excessMode && (
        <div
 className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm"
          onClick={() => setExcessMode(false)}
        >
          <div
 className="flex max-h-[88vh] w-full flex-col overflow-y-auto rounded-t-xl bg-surface shadow-sheet sheet-in p-5 pb-safe"
            onClick={(event) => event.stopPropagation()}
          >
 <h3 className="text-lg font-bold text-fg">O que passou do normal?</h3>
 <p className="mt-1 text-xs leading-relaxed text-dim">
              Conte só o excesso — o resto do dia já foi registrado com base na sua rotina.
            </p>
 <div className="mt-3">
              <FoodLogAssistant onRegistrar={registrarExcesso} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
