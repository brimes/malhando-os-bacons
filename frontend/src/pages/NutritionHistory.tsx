import { useCallback, useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { OriginBadge } from '../components/OriginBadge';
import { MonthlyCalendar } from '../components/MonthlyCalendar';
import { nutritionApi } from '../api/nutrition';
import { getErrorMessage } from '../api/client';
import { isConnectivityError, isLocalId, patchCacheLocally, resourceKeyForRequest } from '../lib/offline';
import { MEAL_TYPE_LABELS, type FoodLog, type MealType, type NutritionCalendarData } from '../types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const UNSYNCED_MESSAGE = 'Este item ainda não foi sincronizado. Conecte-se à internet para alterá-lo.';
const NO_OFFLINE_DATA_MESSAGE = 'Sem conexão e sem dados salvos neste dispositivo.';

const formatDayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

// Same resource key the axios interceptor caches `nutritionApi.getLogs(date)`
// under (see `resourceKeyForRequest`'s call site in api/client.ts) — needed
// here to patch that snapshot in place after an edit made from this screen.
const logsKey = (date: string) => resourceKeyForRequest('/nutrition/logs', { date });

export function NutritionHistoryPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [data, setData] = useState<NutritionCalendarData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;

  // Kept local to this screen, not in useNutritionStore: the store's
  // `todayLogs`/`logsKey` model one day (today) at a time, and reusing it here
  // would make the calendar and the diary fight over the same slot.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<FoodLog[] | null>(null);
  const [isLoadingDay, setIsLoadingDay] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editMealType, setEditMealType] = useState<MealType | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);

  const loadMonth = useCallback(() => nutritionApi.calendar(monthKey).then(setData), [monthKey]);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    // Trocar de mês fecha o dia aberto: ele não existe mais no calendário à vista.
    setSelectedDate(null);
    setDayLogs(null);
    setDayError(null);
    setEditingId(null);
    // A GET's response is cached by the shared axios interceptor regardless of
    // caller, so this already answers from the last snapshot when offline —
    // the only gap was not telling the person anything on a month that was
    // never opened before and has no snapshot to fall back to.
    loadMonth()
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  }, [loadMonth]);

  const cancelEdit = () => {
    setEditingId(null);
    setEditMealType(null);
    setEditError(null);
    setEditSaveError(null);
  };

  const openDay = async (date: string) => {
    if (selectedDate === date) {
      setSelectedDate(null);
      setDayLogs(null);
      setDayError(null);
      cancelEdit();
      return;
    }
    cancelEdit();
    setSelectedDate(date);
    setDayLogs(null);
    setDayError(null);
    setIsLoadingDay(true);
    try {
      setDayLogs(await nutritionApi.getLogs(date));
    } catch (requestError) {
      // The interceptor already falls back to the cached snapshot on a
      // connectivity failure (see api/client.ts) and only rejects when there
      // is none — so reaching this branch with a connectivity error means the
      // day was never opened before on this device, not just "the network is
      // slow right now".
      setDayError(isConnectivityError(requestError) ? NO_OFFLINE_DATA_MESSAGE : getErrorMessage(requestError));
    } finally {
      setIsLoadingDay(false);
    }
  };

  const startEdit = (log: FoodLog) => {
    setEditingId(log.id);
    setEditQuantity(String(log.quantity_g));
    setEditMealType(log.meal_type);
    setEditSaveError(null);
    // Created offline and its POST is still queued: the server has never heard
    // of this id, so a PUT to it can only 404 (online) or get rejected as an
    // unsynced dependency (offline) — either way surfaced up front instead of
    // after the person fills the form and taps Salvar.
    setEditError(isLocalId(log.id) ? UNSYNCED_MESSAGE : null);
  };

  const saveEdit = async (log: FoodLog) => {
    if (isLocalId(log.id) || !editMealType || !selectedDate) return;
    const quantity = Number(editQuantity);
    if (!(quantity > 0)) {
      setEditSaveError('Informe uma quantidade válida.');
      return;
    }
    try {
      const updated = await nutritionApi.updateLog(log.id, { quantity_g: quantity, meal_type: editMealType });
      // Mirrors useNutritionStore's updateLog merge (see its comment): offline,
      // the optimistic PUT only echoes quantity_g/meal_type/id, so the macros
      // it would otherwise inherit from the stale record are rescaled by the
      // same ratio the server applies once it actually processes the write.
      const pending = updated as FoodLog & { offline_pending?: boolean };
      const merged = (dayLogs ?? []).map((current) => {
        if (current.id !== log.id) return current;
        if (pending.offline_pending && current.quantity_g > 0) {
          const ratio = pending.quantity_g / current.quantity_g;
          return {
            ...current,
            ...updated,
            calories: current.calories * ratio,
            protein_g: current.protein_g * ratio,
            carbs_g: current.carbs_g * ratio,
            fat_g: current.fat_g * ratio,
          };
        }
        return { ...current, ...updated };
      });
      setDayLogs(merged);
      // Scoped to the day actually open in this panel — which can be a
      // different day than useNutritionStore's "today" slot. Patching the
      // wrong key (or invalidating none at all) is exactly the bug
      // WorkoutHistory had with a deleted workout resurrecting offline: the
      // stale snapshot for *this* date would keep answering a later cache-only
      // read instead of the edit just made.
      patchCacheLocally(logsKey(selectedDate), merged);
      cancelEdit();
      // Best-effort: refreshes the month's kcal totals/labels so the calendar
      // cell for this day does not keep showing the pre-edit number. Failing
      // silently (typically offline) leaves the calendar as-is, which is no
      // worse than before the edit.
      loadMonth().catch(() => undefined);
    } catch (requestError) {
      setEditSaveError(getErrorMessage(requestError));
    }
  };

  const total = data?.days.reduce((sum, day) => sum + day.calories, 0) ?? 0;
  const maxCalories = Math.max(...(data?.days.map((day) => day.calories) ?? [1]), 1);
  const values = Object.fromEntries((data?.days ?? []).map((day) => [day.date, {
    label: `${Math.round(day.calories)} kcal`,
    intensity: day.calories / maxCalories,
  }]));

  const byMeal = (dayLogs ?? []).reduce<Partial<Record<MealType, FoodLog[]>>>((acc, log) => {
    (acc[log.meal_type] ??= []).push(log);
    return acc;
  }, {});
  const dayTotals = (dayLogs ?? []).reduce(
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
        <div><p className="text-sm text-zinc-500">Calorias registradas no mês</p><p className="text-3xl font-black text-primary-400">{Math.round(total).toLocaleString('pt-BR')} <span className="text-sm font-normal text-zinc-500">kcal</span></p></div>
        {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
        {isLoading ? (
          <div className="py-16 text-center text-zinc-500">Carregando...</div>
        ) : (
          <MonthlyCalendar month={month} values={values} onMonthChange={setMonth} onDayClick={openDay} selectedDate={selectedDate} />
        )}

        {selectedDate ? (
          <div>
            <h3 className="mb-2 px-1 text-xs uppercase tracking-wide text-zinc-500">{formatDayLabel(selectedDate)}</h3>
            {isLoadingDay ? (
              <div className="py-8 text-center text-sm text-zinc-500">Carregando...</div>
            ) : dayError ? (
              <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{dayError}</div>
            ) : (
              <div className="space-y-4">
                <Card className="py-3">
                  <p className="text-lg font-bold text-primary-400">{Math.round(dayTotals.calories)} <span className="text-xs font-normal text-zinc-500">kcal</span></p>
                  <p className="text-xs text-zinc-500">P:{Math.round(dayTotals.protein)}g C:{Math.round(dayTotals.carbs)}g G:{Math.round(dayTotals.fat)}g</p>
                </Card>

                {/* Diferente da tela de hoje, uma refeição sem registro simplesmente não aparece: isto é histórico, não um checklist do dia. */}
                {MEAL_ORDER.filter((meal) => (byMeal[meal]?.length ?? 0) > 0).map((meal) => {
                  const logs = byMeal[meal] ?? [];
                  const mealCal = logs.reduce((sum, log) => sum + log.calories, 0);
                  return (
                    <div key={meal}>
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-white">{MEAL_TYPE_LABELS[meal]}</h4>
                        <span className="text-xs text-zinc-500">{Math.round(mealCal)} kcal</span>
                      </div>
                      <div className="space-y-2">
                        {logs.map((log) => (
                          <Card key={log.id} className="py-3">
                            {editingId === log.id ? (
                              <div className="space-y-2">
                                {editError && <p className="text-xs text-amber-400">{editError}</p>}
                                {editSaveError && <p className="text-xs text-red-400">{editSaveError}</p>}
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    autoFocus
                                    disabled={!!editError}
                                    value={editQuantity}
                                    onChange={(e) => setEditQuantity(e.target.value)}
                                    className="w-20 rounded-lg bg-zinc-800 px-2 py-1.5 text-center text-sm text-white disabled:opacity-50"
                                  />
                                  <span className="text-xs text-zinc-500">g</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {MEAL_ORDER.map((option) => (
                                    <button
                                      key={option}
                                      type="button"
                                      disabled={!!editError}
                                      onClick={() => setEditMealType(option)}
                                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 ${
                                        editMealType === option ? 'bg-primary-600 text-white' : 'bg-zinc-800 text-zinc-400'
                                      }`}
                                    >
                                      {MEAL_TYPE_LABELS[option]}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button size="sm" disabled={!!editError} onClick={() => saveEdit(log)}>Salvar</Button>
                                  <button type="button" onClick={cancelEdit} className="text-xs text-zinc-500">Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => startEdit(log)}>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-white">
                                    {log.food_name}
                                    <OriginBadge origin={log.origin} />
                                  </p>
                                  <p className="text-xs text-zinc-500">{log.quantity_g}g</p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-sm font-semibold text-primary-400">{Math.round(log.calories)} kcal</p>
                                  <p className="text-xs text-zinc-500">
                                    P:{Math.round(log.protein_g)}g C:{Math.round(log.carbs_g)}g G:{Math.round(log.fat_g)}g
                                  </p>
                                </div>
                              </button>
                            )}
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
          <p className="text-center text-xs text-zinc-600">Toque num dia destacado para ver o que você comeu.</p>
        )}
      </div>
    </>
  );
}
