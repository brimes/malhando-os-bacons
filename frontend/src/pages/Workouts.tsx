import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkoutStore } from '../stores/useWorkoutStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';

export function WorkoutsPage() {
  const navigate = useNavigate();
  const { workouts, isLoading, fetchWorkouts } = useWorkoutStore();

  useEffect(() => {
    fetchWorkouts();
  }, [fetchWorkouts]);

  return (
    <>
      <Header
        title="Treinos"
        rightAction={
          <Button size="sm" onClick={() => navigate('/workouts/new')}>
            + Novo
          </Button>
        }
      />
      <div className="px-4 py-4 pb-24 space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : workouts.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <div className="text-6xl">💪</div>
            <p className="text-zinc-400">Nenhum treino ainda</p>
            <Button onClick={() => navigate('/workouts/new')}>
              Criar primeiro treino
            </Button>
          </div>
        ) : (
          workouts.map((workout) => (
            <Card
              key={workout.id}
              onClick={() => navigate(`/workouts/${workout.id}`)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white">{workout.name}</p>
                  <p className="text-sm text-zinc-400 mt-0.5">
                    {new Date(workout.date).toLocaleDateString('pt-BR', {
                      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </p>
                  {workout.notes && (
                    <p className="text-xs text-zinc-500 mt-1 line-clamp-1">{workout.notes}</p>
                  )}
                </div>
                <svg className="w-5 h-5 text-zinc-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
