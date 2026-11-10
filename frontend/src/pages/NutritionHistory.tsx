import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { OriginBadge } from '../components/OriginBadge';
import { MonthlyCalendar } from '../components/MonthlyCalendar';
import { EditFoodLogModal } from '../components/EditFoodLogModal';
import { CopyFoodLogModal } from '../components/CopyFoodLogModal';
import { nutritionApi } from '../api/nutrition';
import { isNetworkOnline } from '../lib/offline';
import {
  createFoodLog,
  dateKey,
  deleteFoodLog,
  foodLogsCache,
  isDateSynced,
  isRangeSynced,
  updateFoodLog,
} from '../lib/local/repo/foodLogs';
import { useLocalAll } from '../lib/local/useLocal';
import { MEAL_TYPE_LABELS, type FoodLog, type MealType, type UpdateFoodLogInput } from '../types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const NO_OFFLINE_DATA_MESSAGE = 'Sem conexão e sem dados salvos neste dispositivo.';

const formatDayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

function monthBounds(month: Date): { from: string; to: string } {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const from = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const to = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/**
 * A day is offered as its own calendar cell only once it has calories to
 * show — mirrors `GET /nutrition/calendar`'s `GROUP BY`, which never returns
 * a day with zero rows either. Kept as its own function so both the
 * always-local aggregate and the network fallback (older months, outside the
 * local pull window) build the exact same shape.
 */
function aggregateByDay(logs: FoodLog[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const log of logs) {
    const key = dateKey(log.date);
    totals[key] = (totals[key] ?? 0) + log.calories;
  }
  return totals;
}

export function NutritionHistoryPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const { from: monthFrom, to: monthTo } = monthBounds(month);

  // Kept local to this screen, not in useNutritionStore: the store's
  // `todayLogs`/`logsKey` model one day (today) at a time, and reusing it here
  // would make the calendar and the diary fight over the same slot.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<FoodLog | null>(null);
  const [copyingLog, setCopyingLog] = useState<FoodLog | null>(null);

  // Local-first: every log this device has ever pulled or written offline,
  // filtered per render. Re-renders on its own whenever a pull or the outbox
  // touch the collection (see `EntityCache.subscribe`) — the calendar cell
  // and the day panel below both come from this one subscription, so an
  // edit made in the day panel updates the month total with no extra plumbing.
  const allLogs = useLocalAll(foodLogsCache);
  const monthLogs = useMemo(
    () => allLogs.filter((log) => { const key = dateKey(log.date); return key >= monthFrom && key <= monthTo; }),
    [allLogs, monthFrom, monthTo],
  );
  const localDays = useMemo(() => aggregateByDay(monthLogs), [monthLogs]);

  // The local pull only covers the last 60 days (see `lib/local/repo/foodLogs.ts`).
  // A month entirely inside that window never needs the network at all; an
  // older one is enriched with it when possible, but only to fill in days
  // this device has no local copy of — never to overwrite one it does, which
  // is what the "não pode sumir e voltar" rule (see the slice description) exists to prevent.
  const monthFullyLocal = isRangeSynced(monthFrom, monthTo);
  const [networkOnlyDays, setNetworkOnlyDays] = useState<Record<string, number>>({});

  useEffect(() => {
    setSelectedDate(null);
    setEditingLog(null);
    setNetworkOnlyDays({});
    if (monthFullyLocal || !isNetworkOnline()) return;
    const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    nutritionApi.calendar(monthKey)
      .then((data) => {
        const fromNetwork: Record<string, number> = {};
        for (const day of data.days) if (!(day.date in localDays)) fromNetwork[day.date] = day.calories;
        setNetworkOnlyDays(fromNetwork);
      })
      .catch(() => undefined);
    // `localDays` intentionally excluded: this only decides which days the
    // network response is allowed to *fill in*, not when to re-fetch — a
    // local write must never itself trigger a network calendar call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthFullyLocal, month]);

  const values = useMemo(() => {
    const merged: Record<string, { label: string; intensity: number }> = {};
    const allDays = { ...networkOnlyDays, ...localDays };
    const maxCalories = Math.max(...Object.values(allDays), 1);
    for (const [date, calories] of Object.entries(allDays)) {
      merged[date] = { label: `${Math.round(calories)} kcal`, intensity: calories / maxCalories };
    }
    return merged;
  }, [localDays, networkOnlyDays]);

  const total = Object.values({ ...networkOnlyDays, ...localDays }).reduce((sum, calories) => sum + calories, 0);

  // The day panel: local logs for `selectedDate`, always reactive. A day this
  // device has genuinely synced (inside the pull window, or with local logs
  // of its own) never shows the offline error — only a day this device has
  // no copy of at all gets the network fallback below, or the "sem dados"
  // message when that fallback can't run either.
  const dayLogsLocal = useMemo(
    () => (selectedDate ? allLogs.filter((log) => dateKey(log.date) === selectedDate) : []),
    [allLogs, selectedDate],
  );
  const dayIsKnownEmpty = selectedDate !== null && dayLogsLocal.length === 0 && isDateSynced(selectedDate);
  const [networkDayLogs, setNetworkDayLogs] = useState<FoodLog[] | null>(null);
  const [isLoadingDayFallback, setIsLoadingDayFallback] = useState(false);
  const [dayFallbackError, setDayFallbackError] = useState<string | null>(null);

  useEffect(() => {
    setNetworkDayLogs(null);
    setDayFallbackError(null);
    if (!selectedDate || dayLogsLocal.length > 0 || dayIsKnownEmpty) return;
    // Outside the pull window and nothing local: the one case this screen
    // still asks the network directly, same as before this slice.
    setIsLoadingDayFallback(true);
    nutritionApi.getLogs(selectedDate)
      .then(setNetworkDayLogs)
      .catch(() => setDayFallbackError(NO_OFFLINE_DATA_MESSAGE))
      .finally(() => setIsLoadingDayFallback(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, dayIsKnownEmpty]);

  const dayLogs = dayLogsLocal.length > 0 ? dayLogsLocal : (networkDayLogs ?? []);

  const openDay = (date: string) => {
    setEditingLog(null);
    setCopyingLog(null);
    setSelectedDate((current) => (current === date ? null : date));
  };

  const handleSaveEdit = async (id: number, input: UpdateFoodLogInput) => {
    await updateFoodLog(id, input);
  };

  // Passa pelo repositório local, não pela API direto: a cópia aparece na hora
  // no calendário e no dia de destino, e sobrevive a estar sem internet — a
  // mesma fila que qualquer outro registro usa.
  const handleCopy = async (log: FoodLog, date: string, mealType: MealType) => {
    await createFoodLog({
      food_item_id: log.food_item_id,
      food_name: log.food_name,
      quantity_g: log.quantity_g,
      meal_type: mealType,
      date,
      calories: log.calories,
      protein_g: log.protein_g,
      carbs_g: log.carbs_g,
      fat_g: log.fat_g,
      origin: log.origin,
    });
  };

  const byMeal = dayLogs.reduce<Partial<Record<MealType, FoodLog[]>>>((acc, log) => {
    (acc[log.meal_type] ??= []).push(log);
    return acc;
  }, {});
  const dayTotals = dayLogs.reduce(
    (acc, log) => ({
      calories: acc.calories + log.calories,
      protein: acc.protein + log.protein_g,
      carbs: acc.carbs + log.carbs_g,
      fat: acc.fat + log.fat_g,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return (
    <>
      <Header title="Histórico de nutrição" showBack />
 <div className="space-y-4 px-4 py-5 pb-24">
 <div><p className="text-sm text-dim">Calorias registradas no mês</p><p className="text-3xl font-black text-brand-fg">{Math.round(total).toLocaleString('pt-BR')} <span className="text-sm font-normal text-dim">kcal</span></p></div>
        {!monthFullyLocal && !isNetworkOnline() && (
 <p className="text-xs text-dim">Alguns dias mais antigos podem não aparecer offline.</p>
        )}
        <MonthlyCalendar month={month} values={values} onMonthChange={setMonth} onDayClick={openDay} selectedDate={selectedDate} />

        {selectedDate ? (
          <div>
 <h3 className="mb-2 px-1 text-xs uppercase tracking-wide text-dim">{formatDayLabel(selectedDate)}</h3>
            {isLoadingDayFallback ? (
 <div className="py-8 text-center text-sm text-dim">Carregando...</div>
            ) : dayFallbackError ? (
 <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{dayFallbackError}</div>
            ) : (
 <div className="space-y-4">
 <Card className="py-3">
 <p className="text-lg font-bold text-brand-fg">{Math.round(dayTotals.calories)} <span className="text-xs font-normal text-dim">kcal</span></p>
 <p className="text-xs text-dim">P:{Math.round(dayTotals.protein)}g C:{Math.round(dayTotals.carbs)}g G:{Math.round(dayTotals.fat)}g</p>
                </Card>

                {/* Diferente da tela de hoje, uma refeição sem registro simplesmente não aparece: isto é histórico, não um checklist do dia. */}
                {MEAL_ORDER.filter((meal) => (byMeal[meal]?.length ?? 0) > 0).map((meal) => {
                  const logs = byMeal[meal] ?? [];
                  const mealCal = logs.reduce((sum, log) => sum + log.calories, 0);
                  return (
                    <div key={meal}>
 <div className="mb-2 flex items-center justify-between">
 <h4 className="text-sm font-semibold text-fg">{MEAL_TYPE_LABELS[meal]}</h4>
 <span className="text-xs text-dim">{Math.round(mealCal)} kcal</span>
                      </div>
 <div className="space-y-2">
                        {logs.map((log) => (
 <Card key={log.id} className="py-3">
 <div className="flex items-center gap-2">
 <button type="button" className="flex min-w-0 flex-1 items-center justify-between text-left" onClick={() => setEditingLog(log)}>
 <div className="min-w-0 flex-1">
 <p className="truncate text-sm font-medium text-fg">
                                  {log.food_name}
                                  <OriginBadge origin={log.origin} />
                                </p>
 <p className="text-xs text-dim">{log.quantity_g}g</p>
                              </div>
 <div className="shrink-0 text-right">
 <p className="text-sm font-semibold text-brand-fg">{Math.round(log.calories)} kcal</p>
 <p className="text-xs text-dim">
                                  P:{Math.round(log.protein_g)}g C:{Math.round(log.carbs_g)}g G:{Math.round(log.fat_g)}g
                                </p>
                              </div>
                            </button>
                            <button
                              type="button"
                              aria-label={`Copiar ${log.food_name} para outro dia`}
                              onClick={() => setCopyingLog(log)}
 className="shrink-0 rounded-lg border border-line px-2.5 py-2 text-xs text-muted active:bg-surface-2"
                            >
                              Copiar
                            </button>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
 <p className="text-center text-xs text-dim">Toque num dia destacado para ver o que você comeu.</p>
        )}
      </div>

      {editingLog && (
        <EditFoodLogModal
          log={editingLog}
          onClose={() => setEditingLog(null)}
          onSave={handleSaveEdit}
          onDelete={deleteFoodLog}
        />
      )}

      {copyingLog && (
        <CopyFoodLogModal
          log={copyingLog}
          onClose={() => setCopyingLog(null)}
          onCopy={(date, mealType) => handleCopy(copyingLog, date, mealType)}
        />
      )}
    </>
  );
}
