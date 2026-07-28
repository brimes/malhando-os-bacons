import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkoutStore } from '../stores/useWorkoutStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
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

  return (
    <>
      <Header title="Novo Treino" showBack />
      <form onSubmit={handleSubmit} className="px-4 py-4 pb-24 space-y-4">
        {/* Basic info */}
        <Card className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-1.5">
              Nome do treino *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Peito e Tríceps"
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-1.5">Duração (minutos)</label>
            <input type="number" min="1" max="600" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Ex: 60" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary-500 transition-colors" />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-1.5">Data</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-1.5">Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Como foi o treino..."
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-primary-500 transition-colors resize-none"
            />
          </div>
        </Card>

        {/* Exercises */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">Exercícios</h3>
            <button type="button" onClick={addSet} className="text-primary-400 text-sm font-medium">
              + Adicionar
            </button>
          </div>

          <div className="space-y-3">
            {sets.map((set, index) => (
              <Card key={index} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500 font-medium">Exercício {index + 1}</span>
                  {sets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSet(index)}
                      className="text-red-500 text-xs"
                    >
                      Remover
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  value={set.exercise_name}
                  onChange={(e) => updateSet(index, 'exercise_name', e.target.value)}
                  placeholder="Nome do exercício"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-primary-500 transition-colors text-sm"
                />

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Séries</label>
                    <input
                      type="number"
                      value={set.sets}
                      min={1}
                      onChange={(e) => updateSet(index, 'sets', Number(e.target.value))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-center focus:outline-none focus:border-primary-500 transition-colors text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">{set.tracking_type === 'time' ? 'Segundos' : 'Reps'}</label>
                    <input type="number" value={set.tracking_type === 'time' ? (set.duration_seconds ?? 60) : set.reps} min={1} onChange={(e) => updateSet(index, set.tracking_type === 'time' ? 'duration_seconds' : 'reps', Number(e.target.value))} className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-center focus:outline-none focus:border-primary-500 transition-colors text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">{set.tracking_type === 'time' ? 'Tipo' : 'Peso (kg)'}</label>
                    {set.tracking_type === 'time' ? <div className="rounded-xl border border-zinc-700 bg-zinc-800 px-2 py-2.5 text-center text-xs text-zinc-400">Tempo</div> :
                    <input
                      type="number"
                      value={set.weight_kg}
                      min={0}
                      step={0.5}
                      onChange={(e) => updateSet(index, 'weight_kg', Number(e.target.value))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-center focus:outline-none focus:border-primary-500 transition-colors text-sm"
                    />}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <Button type="submit" fullWidth size="lg" isLoading={isLoading} disabled={!name.trim()}>
          Salvar Treino
        </Button>
      </form>
    </>
  );
}
