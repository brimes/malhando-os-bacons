import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { trainingPlansApi } from '../api/trainingPlans';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { getErrorMessage } from '../api/client';
import type { TrainingPlanDay, TrainingPlanExercise } from '../types';

const newExercise = (): TrainingPlanExercise => ({ exercise_name: '', sets: 3, reps: 10, tracking_type: 'reps', rest_seconds: 60, notes: '' });
const newDay = (index: number): TrainingPlanDay => ({ name: `Treino ${index + 1}`, focus: '', instructions: '', exercises: [newExercise()] });
const loadingMessages = ['Lendo seu objetivo...', 'Analisando seu histórico...', 'Considerando lesões e preferências...', 'Distribuindo os dias de treino...', 'Montando exercícios e aquecimentos...', 'Revisando o plano...'];
const POLL_INTERVAL_MS = 2000;
const POLL_DEADLINE_MS = 15 * 60 * 1000;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

// The assistant runs in background on the server; poll the job until it settles.
async function waitForPlan(jobId: number): Promise<number> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    await wait(POLL_INTERVAL_MS);
    const job = await trainingPlansApi.getJob(jobId);
    if (job.status === 'done' && job.plan_id) return job.plan_id;
    if (job.status === 'failed') throw new Error(job.error || 'Não foi possível criar o plano');
  }
  throw new Error('A criação do plano está demorando mais que o esperado. Tente novamente em instantes.');
}

export function NewTrainingPlanPage() {
  const navigate = useNavigate();
  const { state } = useOnboardingStore();
  const [method, setMethod] = useState<'automatic' | 'manual'>('automatic');
  const [name, setName] = useState('');
  const [targetDate, setTargetDate] = useState(state?.goal?.target_date?.slice(0, 10) ?? '');
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [duration, setDuration] = useState(60);
  const [description, setDescription] = useState('');
  const [preferences, setPreferences] = useState('');
  const [days, setDays] = useState<TrainingPlanDay[]>(Array.from({ length: 3 }, (_, index) => newDay(index)));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);

  useEffect(() => {
    if (!isSaving || method !== 'automatic') return;
    const interval = window.setInterval(() => setLoadingStep((step) => (step + 1) % loadingMessages.length), 15000);
    return () => window.clearInterval(interval);
  }, [isSaving, method]);

  const changeFrequency = (value: number) => {
    setDaysPerWeek(value);
    setDays((current) => Array.from({ length: value }, (_, index) => current[index] ?? newDay(index)));
  };
  const updateDay = (dayIndex: number, field: keyof TrainingPlanDay, value: string) => setDays((current) => current.map((day, index) => index === dayIndex ? { ...day, [field]: value } : day));
  const updateExercise = (dayIndex: number, exerciseIndex: number, field: keyof TrainingPlanExercise, value: string | number) => setDays((current) => current.map((day, index) => index === dayIndex ? { ...day, exercises: day.exercises.map((exercise, itemIndex) => itemIndex === exerciseIndex ? { ...exercise, [field]: value } : exercise) } : day));
  const addExercise = (dayIndex: number) => setDays((current) => current.map((day, index) => index === dayIndex ? { ...day, exercises: [...day.exercises, newExercise()] } : day));
  const removeExercise = (dayIndex: number, exerciseIndex: number) => setDays((current) => current.map((day, index) => index === dayIndex ? { ...day, exercises: day.exercises.filter((_, itemIndex) => itemIndex !== exerciseIndex) } : day));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (method === 'automatic') {
        const job = await trainingPlansApi.createAutomatic({ name, target_date: targetDate, days_per_week: daysPerWeek, session_duration_minutes: duration, preferences });
        navigate(`/training-plans/${await waitForPlan(job.id)}`);
      } else {
        const plan = await trainingPlansApi.createManual({ name, description, target_date: targetDate, days_per_week: daysPerWeek, session_duration_minutes: duration, days });
        navigate(`/training-plans/${plan.id}`);
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Header title="Novo plano de treino" showBack />
      <form onSubmit={submit} className="space-y-5 px-4 py-5 pb-24">
        <div className="grid grid-cols-2 rounded-2xl bg-zinc-900 p-1"><button type="button" onClick={() => setMethod('automatic')} className={`rounded-xl py-3 text-sm font-semibold ${method === 'automatic' ? 'bg-primary-600 text-white' : 'text-zinc-500'}`}>Automático</button><button type="button" onClick={() => setMethod('manual')} className={`rounded-xl py-3 text-sm font-semibold ${method === 'manual' ? 'bg-primary-600 text-white' : 'text-zinc-500'}`}>Manual</button></div>
        {method === 'automatic' && <Card className="border-primary-900 bg-primary-950/30"><p className="font-semibold text-primary-200">Plano personalizado pelo assistente</p><p className="mt-1 text-xs leading-relaxed text-zinc-500">Usaremos seu objetivo, experiência, fase de adaptação, lesões, testes físicos e histórico completo de treinos.</p></Card>}
        {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
        <Card className="space-y-4">
          <label className="block text-sm text-zinc-300">Nome {method === 'automatic' && <span className="text-zinc-600">(opcional)</span>}<input required={method === 'manual'} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Evolução até dezembro" className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-white focus:border-primary-500 focus:outline-none" /></label>
          {method === 'manual' && <label className="block text-sm text-zinc-300">Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className="mt-2 w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-white focus:border-primary-500 focus:outline-none" /></label>}
          {method === 'automatic' && <label className="block text-sm text-zinc-300">Preferências <span className="text-zinc-600">(opcional)</span><textarea value={preferences} onChange={(event) => setPreferences(event.target.value)} rows={3} maxLength={1000} placeholder="Ex: gosto de treinar com máquinas, não gosto de burpees, prefiro treinar pernas às sextas..." className="mt-2 w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-white focus:border-primary-500 focus:outline-none" /></label>}
          <label className="block text-sm text-zinc-300">Data-alvo<input required type="date" min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-white focus:border-primary-500 focus:outline-none" /></label>
          <div className="grid grid-cols-2 gap-3"><label className="text-sm text-zinc-300">Vezes por semana<select value={daysPerWeek} onChange={(event) => changeFrequency(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-white">{[1,2,3,4,5,6,7].map((value) => <option key={value} value={value}>{value}x</option>)}</select></label><label className="text-sm text-zinc-300">Minutos por treino<input type="number" min="10" max="240" required value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-3 text-white" /></label></div>
        </Card>

        {method === 'manual' && days.map((day, dayIndex) => <Card key={dayIndex} className="space-y-3"><p className="text-xs font-semibold uppercase text-primary-400">Dia {dayIndex + 1}</p><input required value={day.name} onChange={(event) => updateDay(dayIndex, 'name', event.target.value)} placeholder="Nome do treino" className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white" /><input value={day.focus} onChange={(event) => updateDay(dayIndex, 'focus', event.target.value)} placeholder="Foco: pernas, empurrar..." className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white" /><textarea value={day.instructions} onChange={(event) => updateDay(dayIndex, 'instructions', event.target.value)} placeholder="Instruções do dia" rows={2} className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white" />
          <div className="space-y-3">{day.exercises.map((exercise, exerciseIndex) => <div key={exerciseIndex} className="rounded-xl bg-zinc-950 p-3"><div className="flex gap-2"><input required value={exercise.exercise_name} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'exercise_name', event.target.value)} placeholder="Exercício" className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white" />{day.exercises.length > 1 && <button type="button" onClick={() => removeExercise(dayIndex, exerciseIndex)} className="text-xs text-red-400">Remover</button>}</div><select value={exercise.tracking_type} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'tracking_type', event.target.value)} className="mt-2 w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white"><option value="reps">Por repetições</option><option value="time">Por tempo</option></select><div className="mt-2 grid grid-cols-3 gap-2"><input aria-label="Séries" type="number" min="1" value={exercise.sets} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'sets', Number(event.target.value))} className="rounded-lg bg-zinc-900 px-2 py-2 text-center text-sm text-white" />{exercise.tracking_type === 'time' ? <input aria-label="Duração" type="number" min="1" value={exercise.duration_seconds ?? 300} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'duration_seconds', Number(event.target.value))} className="rounded-lg bg-zinc-900 px-2 py-2 text-center text-sm text-white" /> : <input aria-label="Repetições" type="number" min="1" value={exercise.reps} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'reps', Number(event.target.value))} className="rounded-lg bg-zinc-900 px-2 py-2 text-center text-sm text-white" />}<input aria-label="Descanso" type="number" min="0" value={exercise.rest_seconds} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'rest_seconds', Number(event.target.value))} className="rounded-lg bg-zinc-900 px-2 py-2 text-center text-sm text-white" /></div><div className="mt-1 grid grid-cols-3 text-center text-[9px] text-zinc-700"><span>séries</span><span>{exercise.tracking_type === 'time' ? 'segundos' : 'reps'}</span><span>descanso (s)</span></div><input value={exercise.notes} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'notes', event.target.value)} placeholder="Observações" className="mt-2 w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white" /></div>)}</div><button type="button" onClick={() => addExercise(dayIndex)} className="text-sm font-medium text-primary-400">+ Exercício</button></Card>)}

        <button disabled={isSaving} className="w-full rounded-2xl bg-primary-600 py-4 font-bold text-white disabled:opacity-50">{isSaving ? method === 'automatic' ? 'Criando com o assistente...' : 'Salvando...' : method === 'automatic' ? 'Criar plano automaticamente' : 'Salvar plano manual'}</button>
      </form>
      {isSaving && method === 'automatic' && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 px-6 backdrop-blur-sm"><div className="w-full max-w-sm text-center"><div className="relative mx-auto h-28 w-28"><div className="absolute inset-0 animate-ping rounded-full bg-primary-700/20" /><img src="/mob-icon.png" alt="" className="relative h-28 w-28 animate-pulse rounded-3xl object-cover shadow-2xl" /></div><div className="mx-auto mt-7 h-1.5 w-48 overflow-hidden rounded-full bg-zinc-800"><div className="h-full w-2/3 animate-pulse rounded-full bg-primary-500" /></div><h2 className="mt-5 text-xl font-black text-white">Criando seu plano</h2><p className="mt-2 text-sm text-primary-300">{loadingMessages[loadingStep]}</p><p className="mt-4 text-xs text-zinc-600">Isso pode levar alguns minutos. Estamos personalizando cada detalhe.</p></div></div>}
    </>
  );
}
