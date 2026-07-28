import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkoutStore } from '../stores/useWorkoutStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';

export function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedWorkout, isLoading, fetchWorkout, deleteWorkout } = useWorkoutStore();

  useEffect(() => {
    if (id) fetchWorkout(Number(id));
  }, [id, fetchWorkout]);

  const handleDelete = async () => {
    if (!selectedWorkout) return;
    if (!confirm('Deseja excluir este treino?')) return;
    await deleteWorkout(selectedWorkout.id);
    navigate('/workouts');
  };

  if (isLoading || !selectedWorkout) {
    return (
      <>
        <Header title="Treino" showBack />
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  const totalVolume = selectedWorkout.sets?.reduce(
    (sum, s) => sum + s.sets * s.reps * s.weight_kg, 0
  ) ?? 0;

  return (
    <>
      <Header
        title={selectedWorkout.name}
        showBack
        rightAction={
          <Button variant="danger" size="sm" onClick={handleDelete}>
            Excluir
          </Button>
        }
      />
      <div className="px-4 py-4 pb-24 space-y-4">
        {/* Meta */}
        <Card>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide">Data</p>
              <p className="text-sm font-semibold text-white mt-1">
                {new Date(selectedWorkout.date).toLocaleDateString('pt-BR')}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide">Exercícios</p>
              <p className="text-sm font-semibold text-white mt-1">{selectedWorkout.sets?.length ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide">Volume</p>
              <p className="text-sm font-semibold text-white mt-1">{Math.round(totalVolume)}kg</p>
            </div>
          </div>
        </Card>

        {selectedWorkout.notes && (
          <Card>
            <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Anotações</p>
            <p className="text-sm text-zinc-300">{selectedWorkout.notes}</p>
          </Card>
        )}

        {/* Exercises */}
        <div>
          <h3 className="font-semibold text-white mb-3">Exercícios</h3>
          {(selectedWorkout.sets ?? []).length === 0 ? (
            <Card className="text-center text-zinc-500 py-6 text-sm">
              Nenhum exercício registrado
            </Card>
          ) : (
            <div className="space-y-2">
              {selectedWorkout.sets!.map((set) => (
                <Card key={set.id}>
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-white">{set.exercise_name}</p>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-primary-400">
                        {set.tracking_type === 'time' ? `${set.sets} × ${set.duration_seconds ?? 0}s` : `${set.sets}x${set.reps}`}
                      </p>
                      {set.tracking_type !== 'time' && <p className="text-xs text-zinc-400">{set.weight_kg}kg</p>}
                    </div>
                  </div>
                  {set.tracking_type !== 'time' && <p className="text-xs text-zinc-500 mt-1">
                    Volume: {set.sets * set.reps * set.weight_kg}kg
                  </p>}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
