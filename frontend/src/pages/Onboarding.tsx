import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { Button } from '../components/Button';
import { Icon, Segmented, fieldLabel } from '../components/perfil/ui';
import type { BiologicalSex, TrainingExperience } from '../types';

export function OnboardingPage() {
  const navigate = useNavigate();
  const { state, isLoading, isSending, error, saveProfile, sendMessage } = useOnboardingStore();
  const [birthDate, setBirthDate] = useState(state?.profile?.birth_date.slice(0, 10) ?? '');
  const [height, setHeight] = useState(state?.profile?.height_cm?.toString() ?? '');
  const [weight, setWeight] = useState(state?.profile?.current_weight_kg?.toString() ?? '');
  const [biologicalSex, setBiologicalSex] = useState<BiologicalSex | null>(state?.profile?.biological_sex ?? null);
  const [injuriesOrLimitations, setInjuriesOrLimitations] = useState(state?.profile?.injuries_or_limitations ?? '');
  const [trainingExperience, setTrainingExperience] = useState<TrainingExperience | null>(state?.profile?.training_experience ?? null);
  const [message, setMessage] = useState('');

  const saveBodyData = async (event: FormEvent) => {
    event.preventDefault();
    await saveProfile({
      birth_date: birthDate,
      height_cm: Number(height),
      current_weight_kg: Number(weight),
      biological_sex: biologicalSex,
      injuries_or_limitations: injuriesOrLimitations.trim() || null,
      training_experience: trainingExperience!,
    });
  };

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = message.trim();
    if (!content) return;
    setMessage('');
    try {
      await sendMessage(content);
    } catch {
      setMessage(content);
    }
  };

  const profileComplete = Boolean(state?.profile?.training_experience);
  const firstMessage = (state?.messages.length ?? 0) === 0;
  const goalMetrics: Array<{ label: string; value: string }> = [];
  if (state?.goal?.target_weight_kg) goalMetrics.push({ label: 'Peso-alvo', value: `${state.goal.target_weight_kg} kg` });
  if (state?.goal?.target_body_fat_percentage) goalMetrics.push({ label: 'Gordura corporal', value: `${state.goal.target_body_fat_percentage}%` });
  if (state?.goal?.target_muscle_mass_kg) goalMetrics.push({ label: 'Massa muscular', value: `${state.goal.target_muscle_mass_kg} kg` });
  if (state?.goal?.target_six_minute_walk_meters) goalMetrics.push({ label: 'Caminhada de 6 min', value: `${state.goal.target_six_minute_walk_meters} m` });
  if (state?.goal?.conditioning_focus && !state.goal.target_six_minute_walk_meters) goalMetrics.push({ label: 'Referência', value: 'Condicionamento' });

  return (
    // Sem Header nem BottomNav: o inset precisa vir daqui, senão o topo fica
    // sob a Dynamic Island no iOS (no Android o padding nativo cobria tudo).
    <main className="min-h-screen bg-bg px-5 py-8 text-fg pt-safe pb-safe">
      <div className="mx-auto max-w-lg">
        <header className="enter mb-8">
          <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.06em] text-brand-fg">Etapa {profileComplete ? '2' : '1'} de 2</p>
          <h1 className="num text-[28px] leading-[1.02] min-[360px]:text-[34px]">Vamos personalizar seu acompanhamento</h1>
          <div className="mt-5 grid grid-cols-2 gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={2} aria-valuenow={profileComplete ? 2 : 1}>
            <div className="h-2 rounded-chip bg-brand-fg" />
            <div className={`h-2 rounded-chip ${profileComplete ? 'bg-brand-fg' : 'bg-surface-2'}`} />
          </div>
        </header>

        {error && <div className="mb-4 rounded-md bg-danger-soft p-3.5 text-[15px] text-danger" role="alert">{error}</div>}

        {!profileComplete ? (
          <form onSubmit={saveBodyData} className="enter space-y-5">
            <div>
              <h2 className="text-[17px] font-bold">Dados corporais</h2>
              <p className="mt-1 text-[15px] leading-[1.45] text-muted">Usaremos estes dados para calcular idade e tornar os comparativos mais relevantes.</p>
            </div>

            <label className={`block ${fieldLabel}`}>
              Data de nascimento
              <input type="date" required max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} className="mt-2 w-full min-w-0" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className={fieldLabel}>
                Altura (cm)
                <input type="number" required min="50" max="260" step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} placeholder="175" className="mt-2 w-full min-w-0" />
              </label>
              <label className={fieldLabel}>
                Peso atual (kg)
                <input type="number" required min="20" max="500" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="78,5" className="mt-2 w-full min-w-0" />
              </label>
            </div>

            <fieldset>
              <legend className={fieldLabel}>Sexo biológico <span className="font-medium text-dim">(opcional)</span></legend>
              <div className="mt-2">
                <Segmented<string> label="Sexo biológico" cols="grid-cols-3"
                  options={[{ value: 'female', label: 'Feminino' }, { value: 'male', label: 'Masculino' }, { value: 'none', label: 'Não informar' }]}
                  value={biologicalSex ?? 'none'}
                  onChange={(v) => setBiologicalSex(v === 'none' ? null : (v as BiologicalSex))} />
              </div>
            </fieldset>

            <fieldset>
              <legend className={fieldLabel}>Experiência com academia</legend>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {([
                  { v: 'beginner', icon: 'flame', title: 'Sou iniciante', sub: 'Primeiro mês com treinos de adaptação' },
                  { v: 'experienced', icon: 'dumbbell', title: 'Já treino', sub: 'Começa sem fase de adaptação' },
                ] as const).map((o) => {
                  const on = trainingExperience === o.v;
                  return (
                    <button key={o.v} type="button" aria-pressed={on} onClick={() => setTrainingExperience(o.v)}
                      className={`press min-h-[48px] rounded-lg p-4 text-left ${on ? 'bg-brand-soft ring-2 ring-brand-fg' : 'bg-surface-2'}`}>
                      <span className={on ? 'text-brand-fg' : 'text-muted'}><Icon name={o.icon} className="h-6 w-6" /></span>
                      <strong className="mt-2 block text-base text-fg">{o.title}</strong>
                      <span className="mt-1 block text-[13px] leading-[1.35] text-muted">{o.sub}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className={`block ${fieldLabel}`}>
              Lesões, dores ou dificuldade em algum exercício <span className="font-medium text-dim">(opcional)</span>
              <textarea value={injuriesOrLimitations} onChange={(event) => setInjuriesOrLimitations(event.target.value)} maxLength={1000} rows={3} placeholder="Ex.: dor no joelho ao agachar" className="mt-2 w-full resize-none" />
              <span className="mt-1 block text-[13px] font-medium text-muted">Essas informações serão consideradas na criação dos seus treinos.</span>
            </label>

            {biologicalSex === null && (
              <div className="rounded-md bg-sun-soft p-4 text-[15px] leading-[1.45] text-sun">
                Sem essa informação, alguns cálculos e comparativos fisiológicos serão menos precisos, pois as referências variam conforme a biologia. Você poderá informar esse dado depois.
              </div>
            )}

            <Button type="submit" size="lg" fullWidth disabled={!trainingExperience} isLoading={isLoading}>Continuar</Button>
          </form>
        ) : (
          <section className="enter">
            <h2 className="num text-[28px] leading-[1.05]">Qual é o seu objetivo?</h2>
            <p className="mt-2 text-[15px] leading-[1.45] text-muted">Converse naturalmente. Faremos no máximo uma pergunta por vez para entender seu objetivo, peso-alvo e prazo.</p>

            <div className="my-6 space-y-3">
              {state?.messages.map((item, index) => (
                <div key={`${item.created_at}-${index}`} className={`max-w-[88%] break-anywhere rounded-lg px-4 py-3 text-[15px] leading-[1.45] ${item.role === 'user' ? 'ml-auto bg-brand text-white' : 'bg-surface shadow-card text-fg'}`}>
                  {item.content}
                </div>
              ))}
              {isSending && <div className="w-fit rounded-lg bg-surface shadow-card px-4 py-3 text-[15px] text-muted">Analisando seu objetivo...</div>}
            </div>

            {!state?.completed && (
              <form onSubmit={submitMessage} className="space-y-3">
                <textarea required maxLength={1000} rows={firstMessage ? 4 : 2} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={firstMessage ? 'Ex.: quero chegar aos 75 kg em seis meses.' : 'Digite sua resposta...'} className="w-full resize-none" />
                <Button type="submit" size="lg" fullWidth isLoading={isSending}>{firstMessage ? 'Definir meu objetivo' : 'Responder'}</Button>
              </form>
            )}

            <p className="mt-5 text-center text-[13px] leading-[1.4] text-muted">Suas respostas são processadas por IA para estruturar o objetivo. Isso não substitui orientação médica ou nutricional.</p>
          </section>
        )}
      </div>

      {profileComplete && state?.completed && state.goal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 px-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="goal-summary-title">
          <div className="max-h-[90vh] w-full max-w-sm sheet-in overflow-y-auto rounded-xl bg-surface p-6 shadow-sheet">
            <img src="/mob-icon.png" alt="" className="mx-auto mb-4 h-20 w-20 rounded-lg object-cover shadow-card" />
            <p className="text-center text-[13px] font-bold uppercase tracking-[0.06em] text-brand-fg">Objetivo definido</p>
            <h2 id="goal-summary-title" className="num mt-2 text-center text-[32px] leading-[1.05] text-fg">Este é o seu foco</h2>
            <p className="mt-4 text-center text-base leading-[1.5] text-fg">{state.goal.summary}</p>
            {state.goal.feasibility_warning && <div className="mt-3 rounded-md bg-sun-soft p-3.5 text-[15px] leading-[1.45] text-sun">{state.goal.feasibility_warning}</div>}
            <div className="mt-5 grid grid-cols-2 gap-3 text-center">
              {goalMetrics.map((metric) => <div key={metric.label} className="rounded-md bg-surface-2 p-3"><p className="num text-[24px] leading-[1.1] text-brand-fg">{metric.value}</p><p className="mt-1 text-[13px] font-semibold text-muted">{metric.label}</p></div>)}
              <div className="rounded-md bg-surface-2 p-3"><p className="num text-[20px] leading-[1.1] text-brand-fg min-[360px]:text-[24px]">{state.goal.target_date ? new Date(`${state.goal.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '') : 'Definida'}</p><p className="mt-1 text-[13px] font-semibold text-muted">Data-meta</p></div>
            </div>
            <Button autoFocus size="lg" fullWidth onClick={() => navigate('/')} className="mt-6">Ir para o início</Button>
            <p className="mt-3 text-center text-[13px] text-muted">Você pode redefinir este objetivo pelo perfil.</p>
          </div>
        </div>
      )}
    </main>
  );
}
