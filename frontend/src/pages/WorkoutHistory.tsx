import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { MonthlyCalendar } from '../components/MonthlyCalendar';
import { workoutsApi } from '../api/workouts';
import type { WorkoutCalendarData } from '../types';

export function WorkoutHistoryPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [data, setData] = useState<WorkoutCalendarData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => {
    setIsLoading(true);
    workoutsApi.calendar(monthKey).then(setData).finally(() => setIsLoading(false));
  }, [monthKey]);

  const total = data?.days.reduce((sum, day) => sum + day.count, 0) ?? 0;
  const values = Object.fromEntries((data?.days ?? []).map((day) => [day.date, {
    label: `${day.count} ${day.count === 1 ? 'treino' : 'treinos'}`,
    intensity: Math.min(day.count / 2, 1),
  }]));

  return (
    <>
      <Header title="Histórico de treinos" showBack />
      <div className="space-y-4 px-4 py-5 pb-24">
        <div><p className="text-sm text-zinc-500">Total no mês</p><p className="text-3xl font-black text-primary-400">{total} <span className="text-sm font-normal text-zinc-500">treinos</span></p></div>
        {isLoading ? <div className="py-16 text-center text-zinc-500">Carregando...</div> : <MonthlyCalendar month={month} values={values} onMonthChange={setMonth} />}
        <p className="text-center text-xs text-zinc-600">Os dias destacados mostram quando houve treino registrado.</p>
      </div>
    </>
  );
}
