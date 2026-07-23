import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkoutStore } from '../stores/useWorkoutStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import type { WorkoutSetInput } from '../types';

export function NewWorkoutPage() {
  const navigate = useNavigate();
  const { createWorkout, isLoading } = useWorkoutStore();

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [sets, setSets] = useState<WorkoutSetInput[]>([
    { exercise_name: '', sets: 3, reps: 10, weight_kg: 0 },
  ]);

  const addSet = () => {
    setSets((prev) => [...prev, { exercise_name: '', sets: 3, reps: 10, weight_kg: 0 }]);
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
      sets: validSets,
    });
    navigate('/workouts');
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
                    <label className="block text-xs text-zinc-500 mb-1">Reps</label>
                    <input
                      type="number"
                      value={set.reps}
                      min={1}
                      onChange={(e) => updateSet(index, 'reps', Number(e.target.value))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-center focus:outline-none focus:border-primary-500 transition-colors text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Peso (kg)</label>
                    <input
                      type="number"
                      value={set.weight_kg}
                      min={0}
                      step={0.5}
                      onChange={(e) => updateSet(index, 'weight_kg', Number(e.target.value))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-center focus:outline-none focus:border-primary-500 transition-colors text-sm"
                    />
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
