import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuthStore } from '../stores/useAuthStore';
import { Card, StatCard } from '../components/Card';
import { MacroProgress } from '../components/Chart';
import { Button } from '../components/Button';
import type { DashboardData } from '../types';

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiClient.get<DashboardData>('/dashboard')
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setIsLoading(false));
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
      {/* Greeting */}
      <div>
        <p className="text-zinc-400 text-sm capitalize">{todayDate}</p>
        <h2 className="text-2xl font-bold text-white">
          {greeting()}, {user?.name?.split(' ')[0]} 👋
        </h2>
      </div>

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
