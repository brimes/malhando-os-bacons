import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Field, SectionTitle, stagger } from '../components/treinos/states';
import { WaitOverlay } from '../components/treinos/WaitOverlay';
import { Check, Dumbbell, Pencil, Plus, Repeat, Spark, Trash } from '../components/treinos/icons';
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

  const methods = [
    { id: 'automatic' as const, icon: <Spark className="h-6 w-6" />, title: 'Automático', text: 'O assistente monta o plano usando seu objetivo, lesões, testes e histórico.' },
    { id: 'dynamic' as const, icon: <Repeat className="h-6 w-6" />, title: 'Dinâmico', text: 'Um treino novo a cada dia, gerado na hora de treinar.' },
    { id: 'manual' as const, icon: <Pencil className="h-6 w-6" />, title: 'Manual', text: 'Você escreve cada dia e cada exercício.' },
  ];
  const submitLabel = isSaving
    ? (method === 'automatic' ? 'Criando com o assistente...' : method === 'dynamic' ? 'Criando plano...' : 'Salvando...')
    : (method === 'automatic' ? 'Criar plano automaticamente' : method === 'dynamic' ? 'Criar plano dinâmico' : 'Salvar plano manual');

  return (
    <>
      <Header title="Novo plano" showBack />
      <form onSubmit={submit} className="space-y-[14px] px-5 pb-28 pt-2">
        <div role="radiogroup" aria-label="Como criar o plano" className="enter space-y-3">
          {methods.map((m) => {
            const on = method === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMethod(m.id)}
                className={`press flex min-h-[72px] w-full items-center gap-4 rounded-lg p-[18px] text-left shadow-card ${on ? 'tint-brand bg-surface outline outline-2 -outline-offset-2 outline-[rgb(var(--brand-fg))]' : 'bg-surface'}`}
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md ${on ? 'bg-brand text-white' : 'bg-surface-2 text-muted'}`}>{m.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-bold text-fg">{m.title}</span>
                  <span className="mt-0.5 block text-[15px] leading-[1.35] text-muted">{m.text}</span>
                </span>
                {on && <Check className="h-6 w-6 shrink-0 text-brand-fg" />}
              </button>
            );
          })}
        </div>

        {error && <div role="alert" className="rounded-lg bg-danger-soft p-[18px] text-[15px] font-semibold text-danger">{error}</div>}

        <div className="enter space-y-[14px] pt-3" style={stagger(1)}>
          <SectionTitle>Sobre o plano</SectionTitle>
          <Card className="space-y-5">
            {/* Diferente do automático, o servidor exige nome num plano dinâmico: não há
                job em segundo plano que possa preenchê-lo depois (a criação é síncrona). */}
            <Field label="Nome" hint={method === 'automatic' ? 'opcional' : undefined}>
              <input required={method !== 'automatic'} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Evolução até dezembro" className="w-full" />
            </Field>
            {method === 'manual' && (
              <Field label="Descrição">
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className="w-full resize-none" />
              </Field>
            )}
            {method !== 'manual' && (
              <Field label="Preferências" hint="opcional">
                <textarea value={preferences} onChange={(event) => setPreferences(event.target.value)} rows={3} maxLength={1000} placeholder="Ex: gosto de máquinas, não gosto de burpees, prefiro pernas às sextas" className="w-full resize-none" />
              </Field>
            )}
            <Field label="Data-alvo">
              <input required type="date" min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className="w-full" />
            </Field>

            <div>
              <p className="mb-2 text-[13px] font-semibold text-muted">Vezes por semana</p>
              <div role="radiogroup" aria-label="Vezes por semana" className="grid grid-cols-7 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={daysPerWeek === value}
                    onClick={() => changeFrequency(value)}
                    className={`press num flex min-h-[52px] items-center justify-center rounded-md text-[24px] ${daysPerWeek === value ? 'bg-brand text-white' : 'bg-surface-2 text-muted'}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Minutos por treino">
              <input type="number" inputMode="numeric" min="10" max="240" required value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="w-full" />
            </Field>

            <Field label="Academia" hint="opcional">
              <select value={gymId ?? ''} onChange={(event) => setGymId(event.target.value ? Number(event.target.value) : undefined)} className="w-full">
                <option value="">Sem academia específica</option>
                {gyms.map((gym) => <option key={gym.id} value={gym.id}>{gym.name}</option>)}
              </select>
            </Field>
            {gyms.length === 0 && (
              <Button type="button" variant="tonal" fullWidth onClick={() => navigate('/gyms/new')}><Plus className="h-5 w-5" /> Cadastrar uma academia</Button>
            )}
          </Card>
        </div>

        {method === 'manual' && (
          <div className="space-y-[14px] pt-3">
            <SectionTitle>Dias de treino</SectionTitle>
            {days.map((day, dayIndex) => (
              <Card key={dayIndex} className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="num flex h-12 w-12 items-center justify-center rounded-md bg-brand-soft text-[26px] text-brand-fg">{dayIndex + 1}</span>
                  <p className="text-[17px] font-bold text-fg">Dia {dayIndex + 1}</p>
                </div>
                <input required value={day.name} onChange={(event) => updateDay(dayIndex, 'name', event.target.value)} placeholder="Nome do treino" aria-label="Nome do treino" className="w-full" />
                <input value={day.focus} onChange={(event) => updateDay(dayIndex, 'focus', event.target.value)} placeholder="Foco: pernas, empurrar..." aria-label="Foco do dia" className="w-full" />
                <textarea value={day.instructions} onChange={(event) => updateDay(dayIndex, 'instructions', event.target.value)} placeholder="Instruções do dia" aria-label="Instruções do dia" rows={2} className="w-full resize-none" />

                <div className="space-y-3">
                  {day.exercises.map((exercise, exerciseIndex) => (
                    <div key={exerciseIndex} className="space-y-3 rounded-md bg-bg p-3">
                      <div className="flex items-center gap-2">
                        <input required value={exercise.exercise_name} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'exercise_name', event.target.value)} placeholder="Exercício" aria-label="Exercício" className="min-w-0 flex-1 !bg-surface" />
                        {day.exercises.length > 1 && (
                          <button type="button" onClick={() => removeExercise(dayIndex, exerciseIndex)} aria-label="Remover exercício" className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-danger"><Trash className="h-5 w-5" /></button>
                        )}
                      </div>
                      <select value={exercise.tracking_type} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'tracking_type', event.target.value)} aria-label="Tipo de medida" className="w-full !bg-surface">
                        <option value="reps">Por repetições</option>
                        <option value="time">Por tempo</option>
                      </select>
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="Séries">
                          <input type="number" inputMode="numeric" min="1" value={exercise.sets} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'sets', Number(event.target.value))} className="w-full px-2 text-center font-semibold !bg-surface" />
                        </Field>
                        <Field label={exercise.tracking_type === 'time' ? 'Segundos' : 'Reps'}>
                          {exercise.tracking_type === 'time'
                            ? <input type="number" inputMode="numeric" min="1" value={exercise.duration_seconds ?? 300} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'duration_seconds', Number(event.target.value))} className="w-full px-2 text-center font-semibold !bg-surface" />
                            : <input type="number" inputMode="numeric" min="1" value={exercise.reps} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'reps', Number(event.target.value))} className="w-full px-2 text-center font-semibold !bg-surface" />}
                        </Field>
                        <Field label="Descanso (s)">
                          <input type="number" inputMode="numeric" min="0" value={exercise.rest_seconds} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'rest_seconds', Number(event.target.value))} className="w-full px-2 text-center font-semibold !bg-surface" />
                        </Field>
                      </div>
                      <input value={exercise.notes} onChange={(event) => updateExercise(dayIndex, exerciseIndex, 'notes', event.target.value)} placeholder="Observações" aria-label="Observações" className="w-full !bg-surface" />
                    </div>
                  ))}
                </div>
                <Button type="button" variant="tonal" fullWidth onClick={() => addExercise(dayIndex)}><Plus className="h-5 w-5" /> Exercício</Button>
              </Card>
            ))}
          </div>
        )}

        <div className="pt-3">
          <Button type="submit" size="lg" fullWidth isLoading={isSaving}>
            {!isSaving && <Dumbbell className="h-5 w-5" />}
            {submitLabel}
          </Button>
        </div>
      </form>
      {isSaving && method === 'automatic' && (
        <WaitOverlay title="Criando seu plano" message={loadingMessages[loadingStep]} hint="Isso pode levar alguns minutos. Estamos personalizando cada detalhe." />
      )}
    </>
  );
}
