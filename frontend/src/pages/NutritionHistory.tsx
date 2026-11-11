import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { OriginBadge } from '../components/OriginBadge';
import { KcalCalendar } from '../components/nutricao/KcalCalendar';
import { CountUp } from '../components/CountUp';
import { EmptyState, ErrorState, SkeletonCard } from '../components/nutricao/States';
import { CalendarIcon, CopyIcon } from '../components/nutricao/icons';
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

const formatDayLabel = (date: string) => {
  const t = new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

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
    () => (allLogs ?? []).filter((log) => { const key = dateKey(log.date); return key >= monthFrom && key <= monthTo; }),
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
    () => (selectedDate ? (allLogs ?? []).filter((log) => dateKey(log.date) === selectedDate) : []),
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

  const retryDay = () => {
    if (!selectedDate) return;
    setDayFallbackError(null);
    setIsLoadingDayFallback(true);
    nutritionApi.getLogs(selectedDate)
      .then(setNetworkDayLogs)
      .catch(() => setDayFallbackError(NO_OFFLINE_DATA_MESSAGE))
      .finally(() => setIsLoadingDayFallback(false));
  };
  const macros = [
    { label: 'Proteína', v: dayTotals.protein, c: 'text-violet' },
    { label: 'Carboidrato', v: dayTotals.carbs, c: 'text-sun' },
    { label: 'Gordura', v: dayTotals.fat, c: 'text-brand-fg' },
  ];

  return (
    <>
      <Header title="Calendário" showBack />
      <div className="space-y-[14px] px-5 pb-24 pt-2">
        <div className="enter">
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Calorias no mês</p>
          <p className="num text-[44px] leading-none text-teal">
            <CountUp value={Math.round(total)} format={(n) => n.toLocaleString('pt-BR')} />
            <span className="font-sans text-[15px] font-medium text-muted"> kcal</span>
          </p>
          {!monthFullyLocal && !isNetworkOnline() && (
            <p className="mt-2 text-[15px] text-muted">Alguns dias mais antigos podem não aparecer offline.</p>
          )}
        </div>

        <div className="enter" style={{ '--i': 1 } as React.CSSProperties}>
          <KcalCalendar month={month} values={values} onMonthChange={setMonth} onDayClick={openDay} selectedDate={selectedDate} />
        </div>

        {selectedDate ? (
          <div className="space-y-[14px]">
            <h2 className="text-[17px] font-bold text-fg">{formatDayLabel(selectedDate)}</h2>
            {isLoadingDayFallback ? (
              <SkeletonCard rows={2} />
            ) : dayFallbackError ? (
              <ErrorState message={dayFallbackError} onRetry={retryDay} />
            ) : (
              <>
                {dayLogs.length === 0 && <p className="text-[15px] text-muted">Nada registrado neste dia.</p>}
                <Card tint="teal" className="enter">
                  <p className="num text-[38px] leading-[1.05] text-teal">{Math.round(dayTotals.calories)}<span className="font-sans text-[15px] font-medium text-muted"> kcal</span></p>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    {macros.map((m) => (
                      <div key={m.label} className="min-w-0">
                        <p className="truncate text-[13px] text-muted">{m.label}</p>
                        <p className={`num text-[24px] leading-[1.1] ${m.c}`}>{Math.round(m.v)}<span className="font-sans text-[13px] font-medium text-muted"> g</span></p>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Histórico, não checklist: refeição sem registro não aparece. */}
                {MEAL_ORDER.filter((meal) => (byMeal[meal]?.length ?? 0) > 0).map((meal, mi) => {
                  const logs = byMeal[meal] ?? [];
                  const mealCal = logs.reduce((sum, log) => sum + log.calories, 0);
                  return (
                    <div key={meal} className="enter" style={{ '--i': mi + 2 } as React.CSSProperties}>
                      <Card className="!px-0">
                        <div className="flex items-center justify-between px-[18px]">
                          <h3 className="text-[17px] font-bold text-fg">{MEAL_TYPE_LABELS[meal]}</h3>
                          <p className="num text-[24px] leading-[1.1] text-fg">{Math.round(mealCal)}<span className="font-sans text-[13px] font-medium text-muted"> kcal</span></p>
                        </div>
                        <ul className="mt-1">
                          {logs.map((log) => (
                            <li key={log.id} className="flex min-h-[64px] items-center gap-1 pl-[18px] pr-2">
                              <button type="button" className="press flex min-h-[64px] min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setEditingLog(log)}>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-base font-semibold text-fg">{log.food_name}</p>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                                    <span className="num text-[15px] text-muted">{Math.round(log.quantity_g)} g</span>
                                    <OriginBadge origin={log.origin} />
                                  </div>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="num text-[22px] leading-[1.1] text-fg">{Math.round(log.calories)}</p>
                                  <p className="text-[13px] text-dim">kcal</p>
                                </div>
                              </button>
                              <button type="button" aria-label={`Copiar ${log.food_name} para outro dia`} onClick={() => setCopyingLog(log)} className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-teal">
                                <CopyIcon />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </Card>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        ) : Object.keys(values).length === 0 ? (
          <Card>
            <EmptyState icon={<CalendarIcon />} title="Nenhum registro neste mês" text="Os dias com comida registrada aparecem aqui, mais escuros quanto mais calorias." />
          </Card>
        ) : (
          <p className="text-center text-[15px] text-muted">Toque num dia destacado para ver o que você comeu.</p>
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
