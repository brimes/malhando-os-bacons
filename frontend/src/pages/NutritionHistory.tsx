import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { MonthlyCalendar } from '../components/MonthlyCalendar';
import { nutritionApi } from '../api/nutrition';
import type { NutritionCalendarData } from '../types';

export function NutritionHistoryPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [data, setData] = useState<NutritionCalendarData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => {
    setIsLoading(true);
    nutritionApi.calendar(monthKey).then(setData).finally(() => setIsLoading(false));
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
        {isLoading ? <div className="py-16 text-center text-zinc-500">Carregando...</div> : <MonthlyCalendar month={month} values={values} onMonthChange={setMonth} />}
        <p className="text-center text-xs text-zinc-600">As calorias são somadas a partir dos alimentos registrados em cada dia.</p>
      </div>
    </>
  );
}
