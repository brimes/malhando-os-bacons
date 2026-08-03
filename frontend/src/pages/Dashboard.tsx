import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../stores/useAuthStore';
import { Card, StatCard } from '../components/Card';
import { MacroProgress } from '../components/Chart';
import { Button } from '../components/Button';
import { workoutsApi } from '../api/workouts';
import { SyncBanner } from '../components/SyncStatus';
import { CompensationCard } from '../components/CompensationCard';
import type { ActiveWorkout, DashboardData } from '../types';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { todayLocalDate } from '../lib/date';

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { state: onboarding } = useOnboardingStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkout | null>(null);

  useEffect(() => {
    // Keyed by date so the offline cache does not serve yesterday's
    // aggregate (nutrition, steps, workout of the day) forever — a bare
    // `get:/dashboard` key would never expire on its own.
    apiClient.get<DashboardData>('/dashboard', { params: { date: todayLocalDate() } })
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setIsLoading(false));
    // A session left open (screen locked, app closed) can be resumed from here.
    workoutsApi.active().then(setActiveWorkout).catch(() => setActiveWorkout(null));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  const todayDate = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div className="px-4 py-6 space-y-6 pb-24">
      {/* Only renders when offline or with something pending. */}
      <div className="-mx-4 -mt-3"><SyncBanner /></div>
      {/* Greeting */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-zinc-400 text-sm capitalize">{todayDate}</p>
          <h2 className="text-2xl font-bold text-white">
            {greeting()}, {user?.name?.split(' ')[0]} 👋
          </h2>
        </div>
        <img src="/mob-icon.png" alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover drop-shadow-xl" />
      </div>

      {activeWorkout && (
        <button onClick={() => navigate('/workouts/session')} className="flex w-full items-center gap-4 rounded-2xl border border-primary-700 bg-primary-950 p-4 text-left">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-xl">▶</div>
          <div className="flex-1">
            <p className="font-bold text-primary-100">Treino em andamento</p>
            <p className="mt-0.5 text-xs text-zinc-400">{activeWorkout.day_name || activeWorkout.workout.name} · toque para continuar</p>
          </div>
          <span className="text-xl text-primary-400">›</span>
        </button>
      )}

      {!activeWorkout && data?.today_workout && (
        <div className="rounded-2xl border border-emerald-800 bg-gradient-to-br from-emerald-950 to-zinc-900 p-5 text-center">
          <p className="text-4xl">🎉</p>
          <h3 className="mt-2 text-xl font-black text-emerald-100">Treino de hoje concluído!</h3>
          <p className="mt-1 text-sm text-emerald-300/80">{data.today_workout.name}</p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            Constância é o que constrói resultado. Nos vemos no próximo treino.
          </p>
        </div>
      )}

      {!activeWorkout && !data?.today_workout && data?.next_workout && (
        <button
          onClick={() => navigate(`/training-plans/${data.next_workout!.plan_id}/days/${data.next_workout!.day_id}`)}
          className="w-full rounded-2xl border border-primary-700 bg-gradient-to-br from-primary-950 to-zinc-900 p-5 text-left"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-400">Seu próximo treino</p>
          <h3 className="mt-1 text-xl font-black leading-tight text-white">{data.next_workout.day_name}</h3>
          {data.next_workout.focus && <p className="mt-0.5 text-sm text-zinc-400">{data.next_workout.focus}</p>}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-zinc-500">
              {data.days_since_last_workout == null
                ? 'Seu primeiro treino'
                : data.days_since_last_workout === 0
                  ? 'Você treinou hoje mais cedo'
                  : `Há ${data.days_since_last_workout} ${data.days_since_last_workout === 1 ? 'dia' : 'dias'} sem treinar`}
            </span>
            <span className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white">Iniciar ›</span>
          </div>
        </button>
      )}

      {data?.weekly_performance && (() => {
        const perf = data.weekly_performance;
        const pct = Math.min(100, Math.round((perf.done_this_week / perf.target_per_week) * 100));
        const tone = perf.on_track
          ? { border: 'border-emerald-800', bar: 'bg-emerald-500', text: 'text-emerald-300' }
          : perf.still_possible
            ? { border: 'border-primary-800', bar: 'bg-primary-500', text: 'text-primary-300' }
            : { border: 'border-amber-900', bar: 'bg-amber-500', text: 'text-amber-300' };
        const message = perf.on_track
          ? 'Meta da semana batida. Excelente!'
          : perf.still_possible
            ? `Faltam ${perf.remaining} ${perf.remaining === 1 ? 'treino' : 'treinos'} e ainda restam ${perf.days_left_in_week} ${perf.days_left_in_week === 1 ? 'dia' : 'dias'}. Dá tempo!`
            // Zero dias restantes só passou a ser alcançável quando o dia em que
            // já se treinou deixou de contar; sem este ramo a frase vira
            // "faltam 2 treinos para 0 dias".
            : perf.days_left_in_week === 0
              ? `A semana fechou com ${perf.remaining} ${perf.remaining === 1 ? 'treino' : 'treinos'} a menos. Volte firme na próxima.`
              : `Faltam ${perf.remaining} ${perf.remaining === 1 ? 'treino' : 'treinos'} para ${perf.days_left_in_week} ${perf.days_left_in_week === 1 ? 'dia' : 'dias'}. Recupere o que der e volte firme na próxima semana.`;
        return (
          <div className={`rounded-2xl border ${tone.border} bg-zinc-900 p-4`}>
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Desempenho da semana</p>
              <p className="text-sm font-black text-white">{perf.done_this_week} de {perf.target_per_week}</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className={`h-full rounded-full ${tone.bar} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <p className={`mt-2 text-sm leading-relaxed ${tone.text}`}>{message}</p>
            <p className="mt-1 text-xs text-zinc-600">{perf.plan_name}</p>
          </div>
        );
      })()}

      {onboarding?.goal?.conditioning_focus && !onboarding.fitness_assessment && (
        <button onClick={() => navigate('/fitness-assessment')} className="flex w-full items-center gap-4 rounded-2xl border border-primary-800 bg-primary-950/60 p-4 text-left">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-700 text-xl">♥</div>
          <div className="flex-1"><p className="font-bold text-primary-200">Fazer teste de condicionamento</p><p className="mt-0.5 text-xs text-zinc-500">Crie sua linha de base com uma caminhada de 6 minutos</p></div>
          <span className="text-xl text-primary-400">›</span>
        </button>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Treinos essa semana"
          value={data?.workout_stats.workouts_this_week ?? 0}
          unit="dias"
          color="text-primary-400"
        />
        <StatCard
          label="Sequência"
          value={data?.workout_stats.streak_days ?? 0}
          unit="dias"
          color="text-amber-400"
        />
        <StatCard
          label="Passos hoje"
          value={(data?.today_steps?.count ?? 0).toLocaleString()}
          color="text-blue-400"
        />
        <StatCard
          label="Kcal gastas"
          value={Math.round(data?.today_steps?.calories_burned ?? 0)}
          unit="kcal"
          color="text-green-400"
        />
      </div>

      {/* Today's workout */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white">Treino de hoje</h3>
          <button onClick={() => navigate('/workouts')} className="text-primary-400 text-sm">
            Ver todos
          </button>
        </div>
        {data?.today_workout ? (
          <Card
            onClick={() => navigate(`/workouts/${data.today_workout!.id}`)}
            className="flex items-center justify-between"
          >
            <div>
              <p className="font-semibold text-white">{data.today_workout.name}</p>
              <p className="text-sm text-zinc-400">
                {data.today_workout.sets?.length ?? 0} exercícios
              </p>
            </div>
            <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Card>
        ) : (
          <Card className="text-center py-6">
            <p className="text-zinc-500 text-sm mb-3">Nenhum treino registrado hoje</p>
            <Button size="sm" onClick={() => navigate('/workouts/new')}>
              Registrar treino
            </Button>
          </Card>
        )}
      </div>

      <CompensationCard />

      {/* Nutrition summary */}
      {data?.active_plan && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">Nutrição hoje</h3>
            <button onClick={() => navigate('/nutrition')} className="text-primary-400 text-sm">
              Detalhes
            </button>
          </div>
          <Card>
            <MacroProgress
              calories={data.today_nutrition.calories}
              caloriesTarget={data.active_plan.calories_target}
              protein={data.today_nutrition.protein_g}
              proteinTarget={data.active_plan.protein_target}
              carbs={data.today_nutrition.carbs_g}
              carbsTarget={data.active_plan.carbs_target}
              fat={data.today_nutrition.fat_g}
              fatTarget={data.active_plan.fat_target}
            />
          </Card>
        </div>
      )}

      {/* Weekly activity */}
      {(data?.weekly_workouts?.length ?? 0) > 0 && (
        <div>
          <h3 className="font-semibold text-white mb-3">Treinos da semana</h3>
          <div className="space-y-2">
            {data!.weekly_workouts.map((workout) => (
              <Card
                key={workout.id}
                onClick={() => navigate(`/workouts/${workout.id}`)}
                className="flex items-center justify-between py-3"
              >
                <div>
                  <p className="font-medium text-white text-sm">{workout.name}</p>
                  <p className="text-xs text-zinc-500">
                    {new Date(workout.date).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </p>
                </div>
                <svg className="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
