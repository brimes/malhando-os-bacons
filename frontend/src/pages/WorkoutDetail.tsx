import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkoutStore } from '../stores/useWorkoutStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { CountUp } from '../components/CountUp';
import { EmptyState, ErrorState, Skel, SectionTitle, stagger } from '../components/treinos/states';
import { Calendar, Clock, Dumbbell, Layers, Trash } from '../components/treinos/icons';

export function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedWorkout, isLoading, error, fetchWorkout, deleteWorkout } = useWorkoutStore();

  useEffect(() => {
    if (id) fetchWorkout(Number(id));
  }, [id, fetchWorkout]);

  const handleDelete = async () => {
    if (!selectedWorkout) return;
    if (!confirm('Deseja excluir este treino?')) return;
    await deleteWorkout(selectedWorkout.id);
    navigate('/workouts');
  };

  const workout = selectedWorkout && selectedWorkout.id === Number(id) ? selectedWorkout : null;

  if (!workout) {
    return (
      <>
        <Header title="Treino" showBack />
        <div className="space-y-[14px] px-5 pt-2">
          {error && !isLoading ? (
            <>
              <ErrorState message={error} onRetry={() => id && fetchWorkout(Number(id))} />
              <EmptyState icon={<Dumbbell />} title="Treino não encontrado" action={{ label: 'Voltar para treinos', onClick: () => navigate('/workouts') }} />
            </>
          ) : (
            <div role="status" aria-label="Carregando" className="space-y-[14px]">
              <Skel className="h-[210px] rounded-xl" />
              <Skel className="h-[72px] rounded-lg" />
              <Skel className="h-[72px] rounded-lg" />
              <Skel className="h-[72px] rounded-lg" />
            </div>
          )}
        </div>
      </>
    );
  }

  const sets = workout.sets ?? [];
  const totalVolume = sets.reduce((sum, s) => sum + s.sets * s.reps * s.weight_kg, 0);
  const totalSets = sets.reduce((sum, s) => sum + s.sets, 0);
  const date = new Date(workout.date);

  return (
    <>
      <Header
        title={workout.name}
        showBack
        rightAction={
          <button type="button" onClick={handleDelete} aria-label="Excluir treino" className="press flex h-12 w-12 items-center justify-center rounded-md text-danger">
            <Trash className="h-6 w-6" />
          </button>
        }
      />
      <div className="space-y-[14px] px-5 pb-28 pt-2">
        <div className="enter bg-hero rounded-xl p-5 text-white shadow-card">
          <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-white/90">Volume total</p>
          <p className="num mt-1 text-[64px] leading-none">
            <CountUp value={Math.round(totalVolume)} format={(n) => n.toLocaleString('pt-BR')} />
            <span className="font-sans text-[20px] font-semibold text-white/90"> kg</span>
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {[
              { icon: <Calendar />, text: date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }) },
              { icon: <Dumbbell />, text: `${sets.length} ${sets.length === 1 ? 'exercício' : 'exercícios'}` },
              { icon: <Layers />, text: `${totalSets} séries` },
              ...(workout.duration_minutes ? [{ icon: <Clock />, text: `${workout.duration_minutes} min` }] : []),
            ].map((c) => (
              <span key={c.text} className="inline-flex h-8 items-center gap-1.5 rounded-chip bg-white/20 px-3 text-[13px] font-semibold text-white [&>svg]:h-[15px] [&>svg]:w-[15px]">{c.icon}{c.text}</span>
            ))}
          </div>
        </div>

        {workout.notes && (
          <div className="enter" style={stagger(1)}>
            <Card>
              <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">Anotações</p>
              <p className="mt-1.5 text-[16px] leading-[1.5] text-fg">{workout.notes}</p>
            </Card>
          </div>
        )}

        <div className="enter space-y-[14px] pt-3" style={stagger(2)}>
          <SectionTitle right={<Chip tone="violet">{sets.length}</Chip>}>Exercícios</SectionTitle>
          {sets.length === 0 ? (
            <Card className="py-6 text-center text-[15px] text-muted">Nenhum exercício registrado</Card>
          ) : (
            sets.map((set) => (
              <Card key={set.id} className="flex min-h-[72px] items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-bold leading-[1.3] text-fg">{set.exercise_name}</p>
                  <p className="num mt-1 text-[22px] leading-none text-brand-fg">
                    {set.tracking_type === 'time' ? `${set.sets} × ${set.duration_seconds ?? 0}s` : `${set.sets} × ${set.reps}`}
                  </p>
                </div>
                {set.tracking_type !== 'time' && (
                  <div className="shrink-0 text-right">
                    <p className="num text-[32px] leading-none text-fg">{set.weight_kg}<span className="font-sans text-[15px] font-medium text-muted"> kg</span></p>
                    <p className="mt-1 text-[13px] text-muted">{Math.round(set.sets * set.reps * set.weight_kg).toLocaleString('pt-BR')} kg de volume</p>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      </div>
    </>
  );
}
