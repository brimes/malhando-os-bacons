import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { MonthlyCalendar } from '../components/MonthlyCalendar';
import { nutritionApi } from '../api/nutrition';
import { getErrorMessage } from '../api/client';
import type { NutritionCalendarData } from '../types';

export function NutritionHistoryPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [data, setData] = useState<NutritionCalendarData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    // A GET's response is cached by the shared axios interceptor regardless of
    // caller, so this already answers from the last snapshot when offline —
    // the only gap was not telling the person anything on a month that was
    // never opened before and has no snapshot to fall back to.
    nutritionApi.calendar(monthKey)
      .then(setData)
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  }, [monthKey]);

  const total = data?.days.reduce((sum, day) => sum + day.calories, 0) ?? 0;
  const maxCalories = Math.max(...(data?.days.map((day) => day.calories) ?? [1]), 1);
  const values = Object.fromEntries((data?.days ?? []).map((day) => [day.date, {
    label: `${Math.round(day.calories)} kcal`,
    intensity: day.calories / maxCalories,
  }]));

  return (
    <>
      <Header title="Histórico de nutrição" showBack />
      <div className="space-y-4 px-4 py-5 pb-24">
        <div><p className="text-sm text-zinc-500">Calorias registradas no mês</p><p className="text-3xl font-black text-primary-400">{Math.round(total).toLocaleString('pt-BR')} <span className="text-sm font-normal text-zinc-500">kcal</span></p></div>
        {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
        {isLoading ? <div className="py-16 text-center text-zinc-500">Carregando...</div> : <MonthlyCalendar month={month} values={values} onMonthChange={setMonth} />}
        <p className="text-center text-xs text-zinc-600">As calorias são somadas a partir dos alimentos registrados em cada dia.</p>
      </div>
    </>
  );
}
