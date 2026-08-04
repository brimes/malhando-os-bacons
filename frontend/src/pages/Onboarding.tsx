import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '../stores/useOnboardingStore';
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
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-white pt-safe pb-safe">
      <div className="mx-auto max-w-lg">
        <header className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-primary-400">Seu ponto de partida</p>
          <h1 className="text-3xl font-black">Vamos personalizar seu acompanhamento</h1>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <div className={`h-1.5 rounded-full ${profileComplete ? 'bg-primary-500' : 'bg-primary-700'}`} />
            <div className={`h-1.5 rounded-full ${profileComplete ? 'bg-primary-700' : 'bg-zinc-800'}`} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">Etapa {profileComplete ? '2' : '1'} de 2</p>
        </header>

        {error && <div className="mb-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}

        {!profileComplete ? (
          <form onSubmit={saveBodyData} className="space-y-5">
            <div>
              <h2 className="text-xl font-bold">Dados corporais</h2>
              <p className="mt-1 text-sm text-zinc-400">Usaremos estes dados para calcular idade e tornar os comparativos mais relevantes.</p>
            </div>

            <label className="block text-sm text-zinc-300">
              Data de nascimento
              <input type="date" required max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-white focus:border-primary-500 focus:outline-none" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-zinc-300">
                Altura (cm)
                <input type="number" required min="50" max="260" step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} placeholder="175" className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-white focus:border-primary-500 focus:outline-none" />
              </label>
              <label className="text-sm text-zinc-300">
                Peso atual (kg)
                <input type="number" required min="20" max="500" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="78,5" className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-white focus:border-primary-500 focus:outline-none" />
              </label>
            </div>

            <fieldset>
              <legend className="text-sm text-zinc-300">Sexo biológico <span className="text-zinc-600">(opcional)</span></legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                  { value: 'female', label: 'Feminino' },
                  { value: 'male', label: 'Masculino' },
                  { value: null, label: 'Não informar' },
                ].map((option) => (
                  <button key={option.label} type="button" onClick={() => setBiologicalSex(option.value as BiologicalSex | null)} className={`rounded-xl border px-2 py-3 text-xs ${biologicalSex === option.value ? 'border-primary-500 bg-primary-950 text-primary-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400'}`}>
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm text-zinc-300">Experiência com academia</legend>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setTrainingExperience('beginner')} className={`rounded-2xl border p-4 text-left ${trainingExperience === 'beginner' ? 'border-primary-500 bg-primary-950 text-primary-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400'}`}>
                  <span className="block text-lg">🌱</span><strong className="mt-2 block text-sm">Sou iniciante</strong><span className="mt-1 block text-xs opacity-70">Primeiro mês com treinos de adaptação</span>
                </button>
                <button type="button" onClick={() => setTrainingExperience('experienced')} className={`rounded-2xl border p-4 text-left ${trainingExperience === 'experienced' ? 'border-primary-500 bg-primary-950 text-primary-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400'}`}>
                  <span className="block text-lg">🏋️</span><strong className="mt-2 block text-sm">Já treino</strong><span className="mt-1 block text-xs opacity-70">Treinos começam sem fase de adaptação</span>
                </button>
              </div>
            </fieldset>

            <label className="block text-sm text-zinc-300">
              Lesões, dores ou dificuldade em algum exercício <span className="text-zinc-600">(opcional)</span>
              <textarea value={injuriesOrLimitations} onChange={(event) => setInjuriesOrLimitations(event.target.value)} maxLength={1000} rows={3} placeholder="Ex: dor no joelho ao agachar, limitação no ombro direito..." className="mt-2 w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-600 focus:border-primary-500 focus:outline-none" />
              <span className="mt-1 block text-xs text-zinc-600">Essas informações serão consideradas na criação dos seus treinos.</span>
            </label>

            {biologicalSex === null && (
              <div className="rounded-xl border border-amber-900/70 bg-amber-950/30 p-4 text-sm text-amber-200">
                Sem essa informação, alguns cálculos e comparativos fisiológicos serão menos precisos, pois as referências variam conforme a biologia. Você poderá informar esse dado depois.
              </div>
            )}

            <button disabled={isLoading || !trainingExperience} className="w-full rounded-xl bg-primary-600 py-3.5 font-semibold hover:bg-primary-500 disabled:opacity-50">
              {isLoading ? 'Salvando...' : 'Continuar'}
            </button>
          </form>
        ) : (
          <section>
            <h2 className="text-xl font-bold">Qual é o seu objetivo?</h2>
            <p className="mt-1 text-sm text-zinc-400">Converse naturalmente. Faremos no máximo uma pergunta por vez para entender seu objetivo, peso-alvo e prazo.</p>

            <div className="my-6 space-y-3">
              {state?.messages.map((item, index) => (
                <div key={`${item.created_at}-${index}`} className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${item.role === 'user' ? 'ml-auto bg-primary-700 text-white' : 'border border-zinc-800 bg-zinc-900 text-zinc-200'}`}>
                  {item.content}
                </div>
              ))}
              {isSending && <div className="w-fit rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-500">Analisando seu objetivo...</div>}
            </div>

            {!state?.completed && (
              <form onSubmit={submitMessage} className="space-y-3">
                <textarea required maxLength={1000} rows={firstMessage ? 4 : 2} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={firstMessage ? 'Ex: Quero chegar aos 75 kg nos próximos seis meses.' : 'Digite sua resposta...'} className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-600 focus:border-primary-500 focus:outline-none" />
                <button disabled={isSending} className="w-full rounded-xl bg-primary-600 py-3.5 font-semibold hover:bg-primary-500 disabled:opacity-50">{isSending ? 'Aguarde...' : firstMessage ? 'Definir meu objetivo' : 'Responder'}</button>
              </form>
            )}

            <p className="mt-5 text-center text-xs text-zinc-600">Suas respostas são processadas por IA para estruturar o objetivo. Isso não substitui orientação médica ou nutricional.</p>
          </section>
        )}
      </div>

      {profileComplete && state?.completed && state.goal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="goal-summary-title">
          <div className="w-full max-w-sm rounded-3xl border border-primary-900 bg-zinc-900 p-6 shadow-2xl shadow-black">
            <img src="/mob-icon.png" alt="" className="mx-auto -mt-16 mb-4 h-24 w-24 rounded-3xl object-cover shadow-xl" />
            <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-primary-400">Objetivo definido</p>
            <h2 id="goal-summary-title" className="mt-2 text-center text-2xl font-black text-white">Este é o seu foco</h2>
            <p className="mt-4 rounded-2xl bg-zinc-950 p-4 text-sm leading-relaxed text-zinc-200">{state.goal.summary}</p>
            {state.goal.feasibility_warning && <div className="mt-3 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-200">{state.goal.feasibility_warning}</div>}
            <div className="mt-4 grid grid-cols-2 gap-3 text-center">
              {goalMetrics.map((metric) => <div key={metric.label} className="rounded-xl border border-zinc-800 p-3"><p className="text-[10px] uppercase text-zinc-600">{metric.label}</p><p className="mt-1 font-bold text-primary-300">{metric.value}</p></div>)}
              <div className="rounded-xl border border-zinc-800 p-3"><p className="text-[10px] uppercase text-zinc-600">Data-meta</p><p className="mt-1 font-bold text-primary-300">{state.goal.target_date ? new Date(`${state.goal.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : 'Definida'}</p></div>
            </div>
            <button autoFocus onClick={() => navigate('/')} className="mt-6 w-full rounded-xl bg-primary-600 py-3.5 font-semibold text-white hover:bg-primary-500">OK, ir para o início</button>
            <p className="mt-3 text-center text-[10px] text-zinc-600">Você poderá redefinir este objetivo pelo perfil.</p>
          </div>
        </div>
      )}
    </main>
  );
}
