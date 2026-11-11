import { FormEvent, useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Ring } from '../components/Ring';
import { Notice, SectionTitle, fieldLabel, stagger } from '../components/perfil/ui';
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
  const done = seconds === 0;
  const progress = (360 - seconds) / 360;

  return (
    <>
      <Header title="Teste de 6 min" showBack />
      <div className="space-y-[14px] px-5 pb-24 pt-2">
        <div className="enter">
          <Card tint="violet" className="!p-5">
            <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-violet">Caminhada de 6 minutos</p>
            <h2 className="num mt-1 text-[32px] leading-[1.05] text-fg">Meça sua linha de base</h2>
            <p className="mt-3 text-[15px] leading-[1.45] text-muted">
              Em um local plano e seguro, caminhe a maior distância confortável durante seis minutos. Ao terminar,
              registre a distância e como percebeu o esforço.
            </p>
            <div className="mt-4"><Notice tone="sun">
              Faça o teste apenas quando estiver bem. Interrompa se sentir dor no peito, tontura ou falta de ar fora do
              esperado. Este teste não substitui avaliação médica.
            </Notice></div>
          </Card>
        </div>

        <div className="enter" style={stagger(1)}>
          <Card className="flex flex-col items-center !py-6">
            <Ring progress={progress} size={200} stroke={12} colorClass={done ? 'text-ok' : 'text-violet'} animate={false}>
              <div className="text-center">
                <p className={`num text-[56px] leading-none ${done ? 'text-ok' : 'text-fg'}`}>{minutes}:{remainingSeconds}</p>
                <p className="mt-1 text-[13px] font-semibold text-muted">
                  {done ? 'Concluído' : isRunning ? 'Em andamento' : 'Pronto'}
                </p>
              </div>
            </Ring>
            {done && <p className="mt-3 text-[15px] text-muted">Registre os resultados abaixo.</p>}
            <div className="mt-5 flex w-full gap-2">
              <Button size="lg" fullWidth disabled={done} onClick={() => setIsRunning((value) => !value)}>
                {isRunning ? 'Pausar' : seconds < 360 ? 'Continuar' : 'Iniciar teste'}
              </Button>
              <Button size="lg" variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => { setSeconds(360); setIsRunning(false); }}>Reiniciar</Button>
            </div>
          </Card>
        </div>

        <form onSubmit={submit} className="enter space-y-4 pt-2" style={stagger(2)}>
          <SectionTitle>Registrar resultado</SectionTitle>
          {error && <Notice tone="danger">{error}</Notice>}
          <Card className="space-y-4">
            <label className="block">
              <span className={fieldLabel}>Distância percorrida (metros)</span>
              <input required type="number" inputMode="numeric" min="50" max="2000" value={distance} onChange={(event) => setDistance(event.target.value)} placeholder="Ex.: 620" className="mt-1.5 w-full min-w-0" />
            </label>
            <div>
              <div className="flex items-baseline justify-between">
                <span className={fieldLabel}>Esforço percebido</span>
                <span className="num text-[24px] text-violet">{exertion}<span className="font-sans text-[13px] font-semibold text-muted"> de 10</span></span>
              </div>
              <input type="range" min="1" max="10" value={exertion} onChange={(event) => setExertion(event.target.value)} className="mt-3 h-8 w-full accent-violet" aria-label="Esforço percebido de 1 a 10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={fieldLabel}>FC média <span className="font-medium text-dim">(opcional)</span></span>
                <input type="number" inputMode="numeric" min="30" max="240" value={averageHeartRate} onChange={(event) => setAverageHeartRate(event.target.value)} placeholder="bpm" className="mt-1.5 w-full min-w-0" />
              </label>
              <label className="block">
                <span className={fieldLabel}>FC final <span className="font-medium text-dim">(opcional)</span></span>
                <input type="number" inputMode="numeric" min="30" max="240" value={postHeartRate} onChange={(event) => setPostHeartRate(event.target.value)} placeholder="bpm" className="mt-1.5 w-full min-w-0" />
              </label>
            </div>
          </Card>
          <Button type="submit" size="lg" fullWidth isLoading={isSaving}>Salvar avaliação</Button>
        </form>

        <section className="enter pt-2" style={stagger(3)}>
          <SectionTitle>Histórico</SectionTitle>
          {assessments.length === 0 ? (
            <Card className="text-center">
              <p className="text-[15px] leading-[1.45] text-muted">Seu primeiro teste será usado como linha de base.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {assessments.map((assessment, index) => (
                <Card key={assessment.performed_at} tint={index === 0 ? 'violet' : undefined}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`num text-[32px] leading-[1.05] ${index === 0 ? 'text-violet' : 'text-fg'}`}>
                        {assessment.distance_meters}<span className="ml-1 font-sans text-[15px] font-semibold text-muted">m</span>
                      </p>
                      <p className="mt-1 text-[13px] text-muted">
                        {new Date(assessment.performed_at).toLocaleDateString('pt-BR')}, esforço {assessment.perceived_exertion} de 10
                      </p>
                    </div>
                    {index === 0 && <Chip tone="violet" className="shrink-0">Mais recente</Chip>}
                  </div>
                  {(assessment.average_heart_rate || assessment.post_heart_rate) && (
                    <p className="mt-2 text-[13px] text-muted">
                      FC média {assessment.average_heart_rate ?? 'sem dado'}, FC final {assessment.post_heart_rate ?? 'sem dado'} bpm
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
