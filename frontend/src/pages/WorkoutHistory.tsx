import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { CountUp } from '../components/CountUp';
import { TrainingCalendar } from '../components/treinos/TrainingCalendar';
import { ErrorState, Skel, stagger } from '../components/treinos/states';
import { Clock, Layers, Trash } from '../components/treinos/icons';
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
    setError(null);
    loadMonth().catch((requestError) => setError(getErrorMessage(requestError))).finally(() => setIsLoading(false));
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
  const counts = Object.fromEntries((data?.days ?? []).map((day) => [day.date, day.count]));
  const monthName = month.toLocaleDateString('pt-BR', { month: 'long' });

  return (
    <>
      <Header title="Histórico" showBack />
      <div className="space-y-[14px] px-5 pb-28 pt-2">
        <Card tint="violet" className="enter flex items-end justify-between gap-3 !p-5" >
          <div className="min-w-0">
            <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">Treinos em {monthName}</p>
            <p className="num mt-1 text-[56px] leading-none text-violet"><CountUp key={monthKey + total} value={total} /></p>
          </div>
          <p className="pb-1 text-right text-[15px] text-muted">{total === 1 ? 'sessão feita' : 'sessões feitas'}</p>
        </Card>

        {error && <ErrorState message={error} onRetry={() => { setError(null); setIsLoading(true); loadMonth().catch((e) => setError(getErrorMessage(e))).finally(() => setIsLoading(false)); }} />}

        {isLoading ? (
          <Skel className="h-[420px] rounded-lg" />
        ) : (
          <div className="enter" style={stagger(1)}>
            <TrainingCalendar month={month} counts={counts} onMonthChange={setMonth} onDayClick={openDay} selectedDate={selectedDate} />
          </div>
        )}

        {selectedDate ? (
          <div className="enter space-y-[14px] pt-2">
            <h2 className="text-[17px] font-bold text-fg">{formatDayLabel(selectedDate).replace(/^./, (c) => c.toUpperCase())}</h2>
            {isLoadingDay ? (
              <Skel className="h-[96px] rounded-lg" />
            ) : (
              <>
                {(dayWorkouts ?? []).map((workout) => (
                  <Card key={workout.id} className="!p-0">
                    <button type="button" onClick={() => navigate(`/workouts/${workout.id}`)} className="press flex min-h-[72px] w-full items-center gap-3 rounded-lg p-[18px] text-left">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[17px] font-bold text-fg">{workout.name}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Chip icon={<Clock />}>{formatTime(workout.date)}{workout.duration_minutes ? `, ${workout.duration_minutes} min` : ''}</Chip>
                          {workout.set_count ? <Chip icon={<Layers />}>{workout.set_count} {workout.set_count === 1 ? 'série' : 'séries'}</Chip> : null}
                        </div>
                        {workout.notes && <p className="mt-2 line-clamp-2 text-[15px] text-muted">{workout.notes}</p>}
                      </div>
                    </button>
                    <div className="border-t border-line px-2">
                      <button type="button" onClick={() => remove(workout)} aria-label={`Apagar ${workout.name}`} className="press flex min-h-[48px] items-center gap-2 rounded-md px-3 text-[15px] font-semibold text-danger">
                        <Trash className="h-4 w-4" /> Apagar
                      </button>
                    </div>
                  </Card>
                ))}
                {dayWorkouts?.length === 0 && <p className="py-6 text-center text-[15px] text-muted">Nenhum treino neste dia.</p>}
              </>
            )}
          </div>
        ) : (
          !isLoading && <p className="pt-2 text-center text-[15px] text-muted">{total === 0 ? 'Nenhum treino neste mês ainda.' : 'Toque num dia marcado para ver o que você fez.'}</p>
        )}
      </div>
    </>
  );
}
