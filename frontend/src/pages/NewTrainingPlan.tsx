import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { trainingPlansApi } from '../api/trainingPlans';
import { gymsApi } from '../api/gyms';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { getErrorMessage } from '../api/client';
import type { Gym, TrainingPlanDay, TrainingPlanExercise } from '../types';

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
  const [method, setMethod] = useState<'automatic' | 'dynamic' | 'manual'>('automatic');
  const [name, setName] = useState('');
  const [targetDate, setTargetDate] = useState(state?.goal?.target_date?.slice(0, 10) ?? '');
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [duration, setDuration] = useState(60);
  const [description, setDescription] = useState('');
  const [preferences, setPreferences] = useState('');
  const [days, setDays] = useState<TrainingPlanDay[]>(Array.from({ length: 3 }, (_, index) => newDay(index)));
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [gymId, setGymId] = useState<number | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);

  useEffect(() => {
    if (!isSaving || method !== 'automatic') return;
    const interval = window.setInterval(() => setLoadingStep((step) => (step + 1) % loadingMessages.length), 15000);
    return () => window.clearInterval(interval);
  }, [isSaving, method]);

  // Best-effort: sem academia cadastrada, o seletor mostra só o atalho para criar uma.
  useEffect(() => { gymsApi.list().then(setGyms).catch(() => undefined); }, []);

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
        const job = await trainingPlansApi.createAutomatic({ name, target_date: targetDate, days_per_week: daysPerWeek, session_duration_minutes: duration, preferences, gym_id: gymId });
        navigate(`/training-plans/${await waitForPlan(job.id)}`);
      } else if (method === 'dynamic') {
        // Instantâneo: sem job, sem overlay de espera — cada dia é que nasce depois, sob demanda.
        const plan = await trainingPlansApi.createDynamic({ name, target_date: targetDate, days_per_week: daysPerWeek, session_duration_minutes: duration, preferences, gym_id: gymId });
        navigate(`/training-plans/${plan.id}`);
      } else {
        const plan = await trainingPlansApi.createManual({ name, description, target_date: targetDate, days_per_week: daysPerWeek, session_duration_minutes: duration, days, gym_id: gymId });
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
 <div className="grid grid-cols-3 rounded-lg bg-surface p-1"><button type="button" onClick={() => setMethod('automatic')} className={`rounded-md py-3 text-sm font-semibold ${method === 'automatic' ? 'bg-brand text-white' : 'text-dim'}`}>Automático</button><button type="button" onClick={() => setMethod('dynamic')} className={`rounded-md py-3 text-sm font-semibold ${method === 'dynamic' ? 'bg-brand text-white' : 'text-dim'}`}>Dinâmico</button><button type="button" onClick={() => setMethod('manual')} className={`rounded-md py-3 text-sm font-semibold ${method === 'manual' ? 'bg-brand text-white' : 'text-dim'}`}>Manual</button></div>
 {method === 'automatic' && <Card className="border-brand bg-brand-soft"><p className="font-semibold text-brand-fg">Plano personalizado pelo assistente</p><p className="mt-1 text-xs leading-relaxed text-dim">Usaremos seu objetivo, experiência, fase de adaptação, lesões, testes físicos e histórico completo de treinos.</p></Card>}
 {method === 'dynamic' && <Card className="border-brand bg-brand-soft"><p className="font-semibold text-brand-fg">Um treino de cada vez, sob demanda</p><p className="mt-1 text-xs leading-relaxed text-dim">Não há dias fixos para editar aqui: depois de criado, você gera o treino de hoje na hora de treinar, e cada geração é sempre um treino novo.</p></Card>}
 {error && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}
 <Card className="space-y-4">
          {/* Diferente do automático, o servidor exige nome num plano dinâmico: não há
              job em segundo plano que possa preenchê-lo depois (a criação é síncrona). */}
 <label className="block text-sm text-fg">Nome {method === 'automatic' && <span className="text-dim">(opcional)</span>}<input required={method !== 'automatic'} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Evolução até dezembro" className="mt-2 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg focus:outline-none" /></label>
 {method === 'manual' && <label className="block text-sm text-fg">Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className="mt-2 w-full resize-none rounded-md border border-line bg-surface-2 px-4 py-3 text-fg focus:outline-none" /></label>}
 {method !== 'manual' && <label className="block text-sm text-fg">Preferências <span className="text-dim">(opcional)</span><textarea value={preferences} onChange={(event) => setPreferences(event.target.value)} rows={3} maxLength={1000} placeholder="Ex: gosto de treinar com máquinas, não gosto de burpees, prefiro treinar pernas às sextas..." className="mt-2 w-full resize-none rounded-md border border-line bg-surface-2 px-4 py-3 text-fg focus:outline-none" /></label>}
 <label className="block text-sm text-fg">Data-alvo<input required type="date" min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className="mt-2 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg focus:outline-none" /></label>
 <div className="grid grid-cols-2 gap-3"><label className="text-sm text-fg">Vezes por semana<select value={daysPerWeek} onChange={(event) => changeFrequency(Number(event.target.value))} className="mt-2 w-full rounded-md border border-line bg-surface-2 px-3 py-3 text-fg">{[1,2,3,4,5,6,7].map((value) => <option key={value} value={value}>{value}x</option>)}</select></label><label className="text-sm text-fg">Minutos por treino<input type="number" min="10" max="240" required value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="mt-2 w-full rounded-md border border-line bg-surface-2 px-3 py-3 text-fg" /></label></div>
 <label className="block text-sm text-fg">
 Academia <span className="text-dim">(opcional)</span>
 <select value={gymId ?? ''} onChange={(event) => setGymId(event.target.value ? Number(event.target.value) : undefined)} className="mt-2 w-full rounded-md border border-line bg-surface-2 px-3 py-3 text-fg">
              <option value="">Sem academia específica</option>
              {gyms.map((gym) => <option key={gym.id} value={gym.id}>{gym.name}</option>)}
            </select>
          </label>
 {gyms.length === 0 && <button type="button" onClick={() => navigate('/gyms/new')} className="text-xs font-medium text-brand-fg">+ Cadastrar uma academia</button>}
        </Card>

 {method === 'manual' && days.map((day, dayIndex) => <Card key={dayIndex} className="space-y-3"><p className="text-xs font-semibold uppercase text-brand-fg">Dia {dayIndex + 1}</p><input required value={day.name} onChange={(event) => updateDay(dayIndex, 'name', event.target.value)} placeholder="Nome do treino" className="w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-fg" /><input value={day.focus} onChange={(event) => updateDay(dayIndex, 'focus', event.target.value)} placeholder="Foco: pernas, empurrar..." className="w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-fg" /><textarea value={day.instructions} onChange={(event) => updateDay(dayIndex, 'instructions', event.target.value)} placeholder="Instruções do dia" rows={2} className="w-full resize-none rounded-md border border-line bg-surface-2 px-3 py-2.5 text-fg" />
 <div className="space-y-3">{day.exercises.map((exercise, exerciseIndex) => <div key={exerciseIndex} className="rounded-md bg-bg p-3"><div className="flex gap-2"><input required value={exercise.exercise_name} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'exercise_name', event.target.value)} placeholder="Exercício" className="min-w-0 flex-1 rounded-lg shadow-card bg-surface px-3 py-2 text-sm text-fg" />{day.exercises.length > 1 && <button type="button" onClick={() => removeExercise(dayIndex, exerciseIndex)} className="text-xs text-danger">Remover</button>}</div><select value={exercise.tracking_type} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'tracking_type', event.target.value)} className="mt-2 w-full rounded-lg bg-surface px-3 py-2 text-xs text-fg"><option value="reps">Por repetições</option><option value="time">Por tempo</option></select><div className="mt-2 grid grid-cols-3 gap-2"><input aria-label="Séries" type="number" min="1" value={exercise.sets} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'sets', Number(event.target.value))} className="rounded-lg bg-surface px-2 py-2 text-center text-sm text-fg" />{exercise.tracking_type === 'time' ? <input aria-label="Duração" type="number" min="1" value={exercise.duration_seconds ?? 300} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'duration_seconds', Number(event.target.value))} className="rounded-lg bg-surface px-2 py-2 text-center text-sm text-fg" /> : <input aria-label="Repetições" type="number" min="1" value={exercise.reps} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'reps', Number(event.target.value))} className="rounded-lg bg-surface px-2 py-2 text-center text-sm text-fg" />}<input aria-label="Descanso" type="number" min="0" value={exercise.rest_seconds} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'rest_seconds', Number(event.target.value))} className="rounded-lg bg-surface px-2 py-2 text-center text-sm text-fg" /></div><div className="mt-1 grid grid-cols-3 text-center text-xs text-dim"><span>séries</span><span>{exercise.tracking_type === 'time' ? 'segundos' : 'reps'}</span><span>descanso (s)</span></div><input value={exercise.notes} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'notes', event.target.value)} placeholder="Observações" className="mt-2 w-full rounded-lg bg-surface px-3 py-2 text-xs text-fg" /></div>)}</div><button type="button" onClick={() => addExercise(dayIndex)} className="text-sm font-medium text-brand-fg">+ Exercício</button></Card>)}

 <button disabled={isSaving} className="w-full rounded-lg bg-brand py-4 font-bold text-white disabled:opacity-50">{isSaving ? (method === 'automatic' ? 'Criando com o assistente...' : method === 'dynamic' ? 'Criando plano...' : 'Salvando...') : (method === 'automatic' ? 'Criar plano automaticamente' : method === 'dynamic' ? 'Criar plano dinâmico' : 'Salvar plano manual')}</button>
      </form>
 {isSaving && method === 'automatic' && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 px-6 backdrop-blur-sm"><div className="w-full max-w-sm text-center"><div className="relative mx-auto h-28 w-28"><div className="absolute inset-0 animate-ping rounded-full bg-brand-soft" /><img src="/mob-icon.png" alt="" className="relative h-28 w-28 animate-pulse rounded-lg object-cover shadow-2xl" /></div><div className="mx-auto mt-7 h-1.5 w-48 overflow-hidden rounded-full bg-surface-2"><div className="h-full w-2/3 animate-pulse rounded-full bg-brand" /></div><h2 className="mt-5 text-xl font-black text-white">Criando seu plano</h2><p className="mt-2 text-sm text-brand-fg">{loadingMessages[loadingStep]}</p><p className="mt-4 text-xs text-dim">Isso pode levar alguns minutos. Estamos personalizando cada detalhe.</p></div></div>}
    </>
  );
}
