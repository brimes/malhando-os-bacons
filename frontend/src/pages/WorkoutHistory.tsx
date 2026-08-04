import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { MonthlyCalendar } from '../components/MonthlyCalendar';
import { workoutsApi } from '../api/workouts';
import { invalidateCacheByPrefix } from '../lib/offline';
import { listByDate, workoutsCache } from '../lib/local/repo/workouts';
import { getErrorMessage } from '../api/client';
import type { Workout, WorkoutCalendarData } from '../types';

const formatDayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function WorkoutHistoryPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [data, setData] = useState<WorkoutCalendarData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayWorkouts, setDayWorkouts] = useState<Workout[] | null>(null);
  const [isLoadingDay, setIsLoadingDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;

  const loadMonth = useCallback(() => workoutsApi.calendar(monthKey).then(setData), [monthKey]);

  useEffect(() => {
    setIsLoading(true);
    // Trocar de mês fecha o dia aberto: ele não existe mais no calendário à vista.
    setSelectedDate(null);
    setDayWorkouts(null);
    loadMonth().finally(() => setIsLoading(false));
  }, [loadMonth]);

  const openDay = async (date: string) => {
    if (selectedDate === date) {
      setSelectedDate(null);
      setDayWorkouts(null);
      return;
    }
    setSelectedDate(date);
    setDayWorkouts(null);
    setError(null);

    // Dentro da janela sincronizada, o dia sai do aparelho na hora — sem
    // spinner e sem rede. A requisição continua existindo para dia mais antigo
    // que a janela, que nunca esteve aqui.
    await workoutsCache.ensureLoaded();
    const local = listByDate(date);
    if (local.length) {
      setDayWorkouts(local);
      return;
    }

    setIsLoadingDay(true);
    try {
      setDayWorkouts(await workoutsApi.list(date));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoadingDay(false);
    }
  };

  const remove = async (workout: Workout) => {
    if (!window.confirm(`Apagar "${workout.name}"? As séries registradas serão perdidas.`)) return;
    setError(null);
    try {
      await workoutsApi.delete(workout.id);
      // Offline the DELETE is only queued, so the cached lists still contain the
      // workout. Dropping the snapshots keeps it from reappearing and being
      // deleted a second time — the duplicate would 404 on replay.
      invalidateCacheByPrefix('get:/workouts');
      // O mesmo vale para a base local, que agora é de onde a tela lê: sem
      // isto o treino apagado reapareceria no próximo render.
      await workoutsCache.remove(workout.id);
      const [remaining] = await Promise.all([
        selectedDate ? Promise.resolve(listByDate(selectedDate)) : Promise.resolve([]),
        loadMonth(),
      ]);
      setDayWorkouts(remaining);
      if (remaining.length === 0) setSelectedDate(null);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  };

  const total = data?.days.reduce((sum, day) => sum + day.count, 0) ?? 0;
  const values = Object.fromEntries((data?.days ?? []).map((day) => [day.date, {
    label: `${day.count} ${day.count === 1 ? 'treino' : 'treinos'}`,
    intensity: Math.min(day.count / 2, 1),
  }]));

  return (
    <>
      <Header title="Histórico de treinos" showBack />
      <div className="space-y-4 px-4 py-5 pb-24">
        <div>
          <p className="text-sm text-zinc-500">Total no mês</p>
          <p className="text-3xl font-black text-primary-400">{total} <span className="text-sm font-normal text-zinc-500">treinos</span></p>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-zinc-500">Carregando...</div>
        ) : (
          <MonthlyCalendar
            month={month}
            values={values}
            onMonthChange={setMonth}
            onDayClick={openDay}
            selectedDate={selectedDate}
          />
        )}

        {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

        {selectedDate ? (
          <div>
            <h3 className="mb-2 px-1 text-xs uppercase tracking-wide text-zinc-500">{formatDayLabel(selectedDate)}</h3>
            {isLoadingDay ? (
              <div className="py-8 text-center text-sm text-zinc-500">Carregando treinos...</div>
            ) : (
              <div className="space-y-2">
                {(dayWorkouts ?? []).map((workout) => (
                  <Card key={workout.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => navigate(`/workouts/${workout.id}`)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate font-semibold text-white">{workout.name}</p>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                          <span>{formatTime(workout.date)}</span>
                          {workout.duration_minutes ? <span>{workout.duration_minutes} min</span> : null}
                          {workout.set_count ? <span>{workout.set_count} {workout.set_count === 1 ? 'série' : 'séries'}</span> : null}
                        </div>
                        {workout.notes && <p className="mt-1 truncate text-xs italic text-zinc-600">{workout.notes}</p>}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(workout)}
                        aria-label={`Apagar ${workout.name}`}
                        className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-400"
                      >
                        Apagar
                      </button>
                    </div>
                  </Card>
                ))}
                {dayWorkouts?.length === 0 && (
                  <p className="py-6 text-center text-sm text-zinc-600">Nenhum treino neste dia.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-center text-xs text-zinc-600">Toque num dia destacado para ver os treinos realizados.</p>
        )}
      </div>
    </>
  );
}
