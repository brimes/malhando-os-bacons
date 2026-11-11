import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkoutStore } from '../stores/useWorkoutStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field, SectionTitle, stagger } from '../components/treinos/states';
import { Plus, Trash } from '../components/treinos/icons';
import type { TrainingPlanDay, WorkoutSetInput } from '../types';

export function NewWorkoutPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const planState = location.state as { planId?: number; planDay?: TrainingPlanDay; duration?: number } | null;
  const { createWorkout, isLoading } = useWorkoutStore();

  const [name, setName] = useState(planState?.planDay?.name ?? '');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [duration, setDuration] = useState(planState?.duration?.toString() ?? '');
  const [sets, setSets] = useState<WorkoutSetInput[]>(planState?.planDay?.exercises.map((exercise) => ({
    exercise_name: exercise.exercise_name, sets: exercise.sets, reps: exercise.reps, weight_kg: 0,
    tracking_type: exercise.tracking_type, duration_seconds: exercise.duration_seconds,
  })) ?? [{ exercise_name: '', sets: 3, reps: 10, weight_kg: 0 }]);

  const addSet = () => {
    setSets((prev) => [...prev, { exercise_name: '', sets: 3, reps: 10, weight_kg: 0, tracking_type: 'reps' }]);
  };

  const removeSet = (index: number) => {
    setSets((prev) => prev.filter((_, i) => i !== index));
  };

  const updateSet = (index: number, field: keyof WorkoutSetInput, value: string | number) => {
    setSets((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const validSets = sets.filter((s) => s.exercise_name.trim());
    await createWorkout({
      name: name.trim(),
      date: new Date(date).toISOString(),
      notes: notes.trim(),
      training_plan_day_id: planState?.planDay?.id,
      duration_minutes: duration ? Number(duration) : undefined,
      sets: validSets,
    });
    navigate(planState?.planId ? `/training-plans/${planState.planId}` : '/workouts');
  };

  const numInput = 'text-center font-semibold';
  return (
    <>
      <Header title="Novo treino" showBack />
      <form onSubmit={handleSubmit} className="space-y-[14px] px-5 pb-28 pt-2">
        <div className="enter">
          <Card className="space-y-4">
            <Field label="Nome do treino">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Peito e tríceps" required className="w-full" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full" />
              </Field>
              <Field label="Duração" hint="min">
                <input type="number" inputMode="numeric" min="1" max="600" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="60" className={`w-full ${numInput}`} />
              </Field>
            </div>
            <Field label="Observações" hint="opcional">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Como foi o treino..." rows={2} className="w-full resize-none" />
            </Field>
          </Card>
        </div>

        <div className="enter space-y-[14px] pt-3" style={stagger(1)}>
          <SectionTitle>Exercícios</SectionTitle>
          {sets.map((set, index) => (
            <Card key={index} className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="num text-[28px] leading-none text-brand-fg">{String(index + 1).padStart(2, '0')}</span>
                {sets.length > 1 && (
                  <button type="button" onClick={() => removeSet(index)} aria-label={`Remover exercício ${index + 1}`} className="press flex min-h-[48px] items-center gap-2 rounded-md px-3 text-[15px] font-semibold text-danger">
                    <Trash className="h-4 w-4" /> Remover
                  </button>
                )}
              </div>
              <input type="text" value={set.exercise_name} onChange={(e) => updateSet(index, 'exercise_name', e.target.value)} placeholder="Nome do exercício" aria-label="Nome do exercício" className="w-full" />
              <div className="grid grid-cols-3 gap-3">
                <Field label="Séries">
                  <input type="number" inputMode="numeric" value={set.sets} min={1} onChange={(e) => updateSet(index, 'sets', Number(e.target.value))} className={`w-full px-2 ${numInput}`} />
                </Field>
                <Field label={set.tracking_type === 'time' ? 'Segundos' : 'Reps'}>
                  <input type="number" inputMode="numeric" value={set.tracking_type === 'time' ? (set.duration_seconds ?? 60) : set.reps} min={1} onChange={(e) => updateSet(index, set.tracking_type === 'time' ? 'duration_seconds' : 'reps', Number(e.target.value))} className={`w-full px-2 ${numInput}`} />
                </Field>
                <Field label={set.tracking_type === 'time' ? 'Tipo' : 'Peso (kg)'}>
                  {set.tracking_type === 'time'
                    ? <div className="flex min-h-[52px] items-center justify-center rounded-md bg-surface-2 text-[15px] text-muted">Tempo</div>
                    : <input type="number" inputMode="decimal" value={set.weight_kg} min={0} step={0.5} onChange={(e) => updateSet(index, 'weight_kg', Number(e.target.value))} className={`w-full px-2 ${numInput}`} />}
                </Field>
              </div>
            </Card>
          ))}
          <Button type="button" variant="tonal" size="md" fullWidth onClick={addSet}>
            <Plus className="h-5 w-5" /> Adicionar exercício
          </Button>
        </div>

        <div className="pt-3">
          <Button type="submit" fullWidth size="lg" isLoading={isLoading} disabled={!name.trim()}>Salvar treino</Button>
        </div>
      </form>
    </>
  );
}
