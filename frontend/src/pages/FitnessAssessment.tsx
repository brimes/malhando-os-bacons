import { FormEvent, useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { apiClient, getErrorMessage } from '../api/client';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import type { FitnessAssessment, SaveFitnessAssessmentInput } from '../types';

export function FitnessAssessmentPage() {
  const { fetchState } = useOnboardingStore();
  const [assessments, setAssessments] = useState<FitnessAssessment[]>([]);
  const [seconds, setSeconds] = useState(360);
  const [isRunning, setIsRunning] = useState(false);
  const [distance, setDistance] = useState('');
  const [averageHeartRate, setAverageHeartRate] = useState('');
  const [postHeartRate, setPostHeartRate] = useState('');
  const [exertion, setExertion] = useState('5');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = () => apiClient.get<FitnessAssessment[]>('/onboarding/fitness-assessments').then(({ data }) => setAssessments(data));

  useEffect(() => { loadHistory(); }, []);
  useEffect(() => {
    if (!isRunning || seconds === 0) return;
    const timer = window.setInterval(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, seconds]);

  useEffect(() => {
    if (seconds === 0) setIsRunning(false);
  }, [seconds]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    const input: SaveFitnessAssessmentInput = {
      distance_meters: Number(distance),
      average_heart_rate: averageHeartRate ? Number(averageHeartRate) : null,
      post_heart_rate: postHeartRate ? Number(postHeartRate) : null,
      perceived_exertion: Number(exertion),
    };
    try {
      await apiClient.post('/onboarding/fitness-assessments', input);
      await Promise.all([loadHistory(), fetchState()]);
      setDistance('');
      setAverageHeartRate('');
      setPostHeartRate('');
      setSeconds(360);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = String(seconds % 60).padStart(2, '0');

  return (
    <>
      <Header title="Teste de condicionamento" showBack />
 <div className="space-y-5 px-4 py-5 pb-24">
 <Card className="border-brand bg-brand-soft">
 <p className="text-xs font-semibold uppercase tracking-wider text-brand-fg">Caminhada de 6 minutos</p>
 <h2 className="mt-2 text-xl font-black text-fg">Meça sua linha de base</h2>
 <p className="mt-2 text-sm leading-relaxed text-muted">Em um local plano e seguro, caminhe a maior distância confortável durante seis minutos. Ao terminar, registre a distância e como percebeu o esforço.</p>
 <div className="mt-4 rounded-md bg-sun-soft p-3 text-xs leading-relaxed text-sun">Faça o teste apenas quando estiver bem. Interrompa se sentir dor no peito, tontura ou falta de ar fora do esperado. Este teste não substitui avaliação médica.</div>
        </Card>

 <Card className="text-center">
 <p className={`text-5xl font-black tabular-nums ${seconds === 0 ? 'text-ok' : 'text-fg'}`}>{minutes}:{remainingSeconds}</p>
 <p className="mt-2 text-xs text-dim">{seconds === 0 ? 'Teste concluído. Registre os resultados abaixo.' : isRunning ? 'Cronômetro em andamento' : 'Pronto quando você estiver'}</p>
 <div className="mt-4 flex gap-2">
 <button type="button" onClick={() => setIsRunning((value) => !value)} disabled={seconds === 0} className="flex-1 rounded-md bg-brand py-3 text-sm font-semibold text-white disabled:opacity-40">{isRunning ? 'Pausar' : seconds < 360 ? 'Continuar' : 'Iniciar teste'}</button>
 <button type="button" onClick={() => { setSeconds(360); setIsRunning(false); }} className="rounded-md border border-line px-4 text-sm text-muted">Reiniciar</button>
          </div>
        </Card>

 <form onSubmit={submit} className="space-y-4">
 <h3 className="font-bold text-fg">Registrar resultado</h3>
 {error && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}
 <label className="block text-sm text-fg">Distância percorrida (metros)<input required type="number" min="50" max="2000" value={distance} onChange={(event) => setDistance(event.target.value)} placeholder="Ex: 620" className="mt-2 w-full rounded-md shadow-card bg-surface px-4 py-3 text-fg focus:outline-none" /></label>
 <label className="block text-sm text-fg">Esforço percebido: <strong className="text-brand-fg">{exertion}/10</strong><input type="range" min="1" max="10" value={exertion} onChange={(event) => setExertion(event.target.value)} className="mt-3 w-full" /></label>
 <div className="grid grid-cols-2 gap-3">
 <label className="text-sm text-fg">FC média <span className="text-dim">(opcional)</span><input type="number" min="30" max="240" value={averageHeartRate} onChange={(event) => setAverageHeartRate(event.target.value)} placeholder="bpm" className="mt-2 w-full rounded-md shadow-card bg-surface px-3 py-3 text-fg focus:outline-none" /></label>
 <label className="text-sm text-fg">FC ao final <span className="text-dim">(opcional)</span><input type="number" min="30" max="240" value={postHeartRate} onChange={(event) => setPostHeartRate(event.target.value)} placeholder="bpm" className="mt-2 w-full rounded-md shadow-card bg-surface px-3 py-3 text-fg focus:outline-none" /></label>
          </div>
 <button disabled={isSaving} className="w-full rounded-md bg-brand py-3.5 font-semibold text-white disabled:opacity-50">{isSaving ? 'Salvando...' : 'Salvar avaliação'}</button>
        </form>

        <section>
 <h3 className="mb-3 font-bold text-fg">Histórico</h3>
 {assessments.length === 0 ? <Card className="text-center text-sm text-dim">Seu primeiro teste será usado como linha de base.</Card> : (
 <div className="space-y-2">{assessments.map((assessment, index) => (
 <Card key={assessment.performed_at} className={index === 0 ? 'border-brand' : ''}>
 <div className="flex items-center justify-between"><div><p className="text-2xl font-black text-brand-fg">{assessment.distance_meters} m</p><p className="text-xs text-dim">{new Date(assessment.performed_at).toLocaleDateString('pt-BR')} · esforço {assessment.perceived_exertion}/10</p></div>{index === 0 && <span className="rounded-full bg-brand-soft px-2 py-1 text-xs font-semibold text-brand-fg">Mais recente</span>}</div>
 {(assessment.average_heart_rate || assessment.post_heart_rate) && <p className="mt-2 text-xs text-dim">FC média: {assessment.average_heart_rate ?? '—'} · FC final: {assessment.post_heart_rate ?? '—'} bpm</p>}
              </Card>
            ))}</div>
          )}
        </section>
      </div>
    </>
  );
}
