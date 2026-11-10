import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../stores/useAuthStore';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { CountUp } from '../components/CountUp';
import { Bar } from '../components/Ring';
import { MacroProgress } from '../components/Chart';
import { Button } from '../components/Button';
import { workoutsApi } from '../api/workouts';
import { SyncBanner } from '../components/SyncStatus';
import { CompensationCard } from '../components/CompensationCard';
import type { ActiveWorkout, DashboardData } from '../types';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { todayLocalDate } from '../lib/date';
import { readCache, resourceKeyForRequest } from '../lib/offline';

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { state: onboarding } = useOnboardingStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkout | null>(null);

  useEffect(() => {
    const params = { date: todayLocalDate() };
    // O snapshot de hoje que já está no aparelho desenha a tela na hora; a
    // requisição continua e substitui quando chegar. Sem isto, a tela inicial
    // vira spinner inteiro enquanto a rede não responde — que é o que o dono
    // sentia como "o app demorando para abrir".
    //
    // Este agregado ainda é calculado no servidor (sequência, treino da vez,
    // desempenho da semana), então isto é stale-while-revalidate sobre o cache
    // de resposta, não leitura de entidade local como no resto.
    const cached = readCache<DashboardData>(resourceKeyForRequest('/dashboard', params));
    if (cached) {
      setData(cached);
      setIsLoading(false);
    }

    // Keyed by date so the offline cache does not serve yesterday's
    // aggregate (nutrition, steps, workout of the day) forever — a bare
    // `get:/dashboard` key would never expire on its own.
    apiClient.get<DashboardData>('/dashboard', { params })
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setIsLoading(false));
    // A session left open (screen locked, app closed) can be resumed from here.
    workoutsApi.active().then(setActiveWorkout).catch(() => setActiveWorkout(null));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-brand-fg border-t-transparent rounded-full animate-spin" />
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

  const streak = data?.workout_stats.streak_days ?? 0;
  const workoutsThisWeek = data?.workout_stats.workouts_this_week ?? 0;
  const weeklyTarget = data?.weekly_performance?.target_per_week ?? 0;
  const next = data?.next_workout;

  // Séries x repetições; exercício por tempo mostra a duração no lugar das reps.
  const prescription = (ex: NonNullable<typeof next>['exercises'][number]) =>
    ex.tracking_type === 'duration' || (!ex.reps && ex.duration_seconds)
      ? `${ex.sets}×${ex.duration_seconds ?? 0}s`
      : `${ex.sets}×${ex.reps}`;

  const chevron = (
    <svg className="h-5 w-5 shrink-0 text-dim" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );

  const sectionTitle = 'num text-[22px] leading-[1.1] text-fg';

  return (
    // Esta é a única aba sem Header, então o inset do topo precisa vir daqui.
    // No Android não se notava: o padding vem do nativo e cobre o app todo.
    <div className="px-5 py-6 space-y-[14px] pb-24 pt-safe">
      {/* Only renders when offline or with something pending. */}
      <div className="-mx-4 -mt-3"><SyncBanner /></div>
      {/* Greeting */}
      <div className="enter flex items-start justify-between gap-3" style={{ '--i': 0 } as React.CSSProperties}>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold capitalize text-muted">{todayDate}</p>
          <h2 className="num mt-1 text-[32px] leading-[1.05] text-fg">
            {greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h2>
        </div>
        {streak > 0 && (
          <Chip
            tone="sun"
            className="shrink-0"
            icon={
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2c.5 3-1.2 4.6-2.6 6.2C8 9.8 7 11.2 7 13.3A5 5 0 0 0 12 18.5a5 5 0 0 0 5-5.2c0-1.6-.7-2.8-1.5-3.8-.2 1.2-.8 1.9-1.6 2.3.4-3-.2-6.4-1.9-9.8z" />
              </svg>
            }
          >
            {streak} {streak === 1 ? 'dia' : 'dias'}
          </Chip>
        )}
      </div>

      {activeWorkout && (
        <button
          onClick={() => navigate('/workouts/session')}
          className="enter press tint-brand flex min-h-[64px] w-full items-center gap-4 rounded-lg bg-surface p-[18px] text-left shadow-card"
          style={{ '--i': 1 } as React.CSSProperties}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-brand text-white" aria-hidden="true">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-fg">Treino em andamento</p>
            <p className="mt-0.5 truncate text-[13px] text-muted">{activeWorkout.day_name || activeWorkout.workout.name} · toque para continuar</p>
          </div>
          {chevron}
        </button>
      )}

      {!activeWorkout && data?.today_workout && (
        <div className="enter tint-ok flex items-center gap-4 rounded-lg bg-surface p-[18px] shadow-card" style={{ '--i': 1 } as React.CSSProperties}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-ok-soft text-ok" aria-hidden="true">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          </span>
          <div className="min-w-0">
            <h3 className="num text-[22px] leading-[1.1] text-ok">Treino de hoje concluído</h3>
            <p className="mt-0.5 truncate text-sm font-semibold text-fg">{data.today_workout.name}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Constância é o que constrói resultado. Nos vemos no próximo treino.
            </p>
          </div>
        </div>
      )}

      {/* Hero: o único bloco em degradê da tela. Só o botão navega, para não aninhar controles. */}
      {!activeWorkout && !data?.today_workout && next && (
        <div className="enter bg-hero rounded-xl p-5 text-white" style={{ '--i': 2 } as React.CSSProperties}>
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-white/90">Seu próximo treino</p>
          <h3 className="num mt-1 break-words text-[40px] leading-[1.02]">{next.day_name}</h3>
          {next.focus && <p className="mt-1 line-clamp-2 text-[15px] text-white/90">{next.focus}</p>}

          {(() => {
            const nums = [
              { label: 'exercícios', value: next.exercises?.length ?? 0 },
              { label: 'séries', value: next.total_sets ?? 0 },
              { label: 'minutos', value: next.session_duration_minutes ?? 0 },
            ].filter((n) => n.value > 0);
            if (nums.length === 0) return null;
            return (
              <div className="mt-4 flex gap-6">
                {nums.map((n) => (
                  <div key={n.label}>
                    <p className="num text-[34px] leading-none"><CountUp value={n.value} /></p>
                    <p className="mt-1 text-[13px] text-white/90">{n.label}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          {(next.exercises?.length ?? 0) > 0 && (
            <ul className="mt-4 space-y-2">
              {next.exercises.slice(0, 3).map((ex) => (
                <li key={ex.name} className="flex items-baseline justify-between gap-3 text-[15px]">
                  <span className="min-w-0 truncate font-semibold">{ex.name}</span>
                  <span className="shrink-0 text-[13px] text-white/90">
                    <span className="num text-[17px] text-white">{prescription(ex)}</span>
                    {ex.last_weight_kg ? ` · ${ex.last_weight_kg} kg` : ''}
                  </span>
                </li>
              ))}
              {next.exercises.length > 3 && (
                <li className="text-[13px] text-white/90">e mais {next.exercises.length - 3}</li>
              )}
            </ul>
          )}

          <button
            onClick={() => navigate(`/training-plans/${next.plan_id}/days/${next.day_id}`)}
            className="press mt-5 inline-flex min-h-[58px] w-full items-center justify-center gap-2 rounded-md bg-white px-6 text-[17px] font-bold text-brand"
          >
            Começar treino
          </button>
          <p className="mt-3 text-center text-[13px] text-white/90">
            {data!.days_since_last_workout == null
              ? 'Seu primeiro treino'
              : data!.days_since_last_workout === 0
                ? 'Você treinou hoje mais cedo'
                : `Há ${data!.days_since_last_workout} ${data!.days_since_last_workout === 1 ? 'dia' : 'dias'} sem treinar`}
          </p>
        </div>
      )}

      {!activeWorkout && !data?.today_workout && !next && (
        <Card className="enter text-center py-6" >
          <p className="text-muted text-sm mb-3">Nenhum treino registrado hoje</p>
          <Button size="md" onClick={() => navigate('/workouts/new')}>
            Registrar treino
          </Button>
        </Card>
      )}

      {/* Sua semana */}
      {(data?.weekly_performance || (data?.weekly_workouts?.length ?? 0) > 0 || data?.today_workout) && (
        <div className="enter space-y-[14px] pt-2" style={{ '--i': 3 } as React.CSSProperties}>
          <div className="flex items-center justify-between">
            <h3 className={sectionTitle}>Sua semana</h3>
            <button onClick={() => navigate('/workouts')} className="press -mr-2 min-h-[48px] px-2 text-[15px] font-semibold text-brand-fg">
              Ver todos
            </button>
          </div>

          {data?.today_workout && (
            <Card onClick={() => navigate(`/workouts/${data.today_workout!.id}`)} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Treino de hoje</p>
                <p className="truncate text-base font-semibold text-fg">{data.today_workout.name}</p>
                <p className="text-sm text-muted">{data.today_workout.sets?.length ?? 0} exercícios</p>
              </div>
              {chevron}
            </Card>
          )}

          {data?.weekly_performance && (() => {
            const perf = data.weekly_performance;
            const pct = perf.target_per_week > 0 ? Math.min(1, perf.done_this_week / perf.target_per_week) : 0;
            const tone = perf.on_track
              ? { bar: 'bg-ok', text: 'text-ok' }
              : perf.still_possible
                ? { bar: 'bg-brand-fg', text: 'text-brand-fg' }
                : { bar: 'bg-sun', text: 'text-sun' };
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
              <Card>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Desempenho da semana</p>
                  <p className="num shrink-0 text-xl text-fg">{perf.done_this_week} de {perf.target_per_week}</p>
                </div>
                <Bar progress={pct} colorClass={tone.bar} className="mt-3" />
                <p className={`mt-3 text-sm leading-relaxed ${tone.text}`}>{message}</p>
                <p className="mt-1 truncate text-[13px] text-dim">{perf.plan_name}</p>
              </Card>
            );
          })()}

          {(data?.weekly_workouts?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Treinos da semana</p>
              {data!.weekly_workouts.map((workout) => (
                <Card
                  key={workout.id}
                  onClick={() => navigate(`/workouts/${workout.id}`)}
                  className="flex min-h-[56px] items-center justify-between gap-3 !py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-fg">{workout.name}</p>
                    <p className="text-[13px] text-muted">
                      {new Date(workout.date).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  {chevron}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick stats */}
      <div className="enter grid grid-cols-2 gap-3" style={{ '--i': 4 } as React.CSSProperties}>
        <Card tint="violet" className="min-w-0">
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Treinos na semana</p>
          <p className="num mt-1 text-[32px] leading-[1.05] text-violet">
            <CountUp value={workoutsThisWeek} />
            {weeklyTarget > 0 && <span className="font-sans text-[15px] font-medium text-muted"> / {weeklyTarget}</span>}
          </p>
          {weeklyTarget > 0 && <Bar progress={workoutsThisWeek / weeklyTarget} colorClass="bg-violet" className="mt-3" />}
        </Card>
        <Card tint="sun" className="min-w-0">
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Sequência</p>
          <p className="num mt-1 text-[32px] leading-[1.05] text-sun">
            <CountUp value={streak} />
            <span className="font-sans text-[15px] font-medium text-muted"> {streak === 1 ? 'dia' : 'dias'}</span>
          </p>
        </Card>
        <Card tint="teal" className="min-w-0">
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Passos hoje</p>
          <p className="num mt-1 text-[32px] leading-[1.05] text-teal">
            <CountUp value={data?.today_steps?.count ?? 0} format={(n) => n.toLocaleString('pt-BR')} />
          </p>
        </Card>
        <Card tint="brand" className="min-w-0">
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Kcal gastas</p>
          <p className="num mt-1 text-[32px] leading-[1.05] text-fg">
            <CountUp value={Math.round(data?.today_steps?.calories_burned ?? 0)} />
            <span className="font-sans text-[15px] font-medium text-muted"> kcal</span>
          </p>
        </Card>
      </div>

      {onboarding?.goal?.conditioning_focus && !onboarding.fitness_assessment && (
        <button onClick={() => navigate('/fitness-assessment')} className="enter press tint-brand flex min-h-[64px] w-full items-center gap-4 rounded-lg bg-surface p-[18px] text-left shadow-card" style={{ '--i': 5 } as React.CSSProperties}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-brand-soft text-brand-fg" aria-hidden="true">
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-fg">Fazer teste de condicionamento</p>
            <p className="mt-0.5 text-[13px] text-muted">Crie sua linha de base com uma caminhada de 6 minutos</p>
          </div>
          {chevron}
        </button>
      )}

      <CompensationCard />

      {/* Nutrition summary */}
      {data?.active_plan && (
        <Card tint="teal" className="enter" >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="num text-[22px] leading-[1.1] text-teal">Nutrição hoje</h3>
            <button onClick={() => navigate('/nutrition')} className="press -mr-2 min-h-[48px] px-2 text-[15px] font-semibold text-teal">
              Detalhes
            </button>
          </div>
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
      )}
    </div>
  );
}
