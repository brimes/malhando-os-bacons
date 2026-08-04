import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuthStore } from '../stores/useAuthStore';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { getErrorMessage } from '../api/client';
import type { BiologicalSex, TrainingExperience } from '../types';

// Os dados que o onboarding coletou ficavam só lá dentro: para revê-los ou
// corrigir um peso a pessoa teria de refazer a conversa. Esta tela abre pelo
// nome no Perfil, chega preenchida, e salva pelo mesmo endpoint que o
// onboarding usa — nada de rota nova no servidor.

const SEXOS: { value: BiologicalSex; label: string }[] = [
  { value: 'male', label: 'Masculino' },
  { value: 'female', label: 'Feminino' },
];

// Só dois níveis, como o resto do app: `beginner` dispara a fase de adaptação
// e `experienced` não. Inventar um terceiro aqui criaria um valor que nenhuma
// outra tela sabe interpretar.
const EXPERIENCIAS: { value: TrainingExperience; label: string }[] = [
  { value: 'beginner', label: 'Iniciante' },
  { value: 'experienced', label: 'Experiente' },
];

export function ProfileDataPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { state, saveProfile } = useOnboardingStore();
  const profile = state?.profile;

  const [birthDate, setBirthDate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [sex, setSex] = useState<BiologicalSex | ''>('');
  const [experience, setExperience] = useState<TrainingExperience | ''>('');
  const [injuries, setInjuries] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Preenche a partir do que já está no aparelho. O estado do onboarding vem
  // do store, então isto não espera rede.
  useEffect(() => {
    if (!profile) return;
    setBirthDate(String(profile.birth_date ?? '').slice(0, 10));
    setHeightCm(profile.height_cm ? String(profile.height_cm) : '');
    setWeightKg(profile.current_weight_kg ? String(profile.current_weight_kg) : '');
    setSex(profile.biological_sex ?? '');
    setExperience(profile.training_experience ?? '');
    setInjuries(profile.injuries_or_limitations ?? '');
  }, [profile]);

  const height = Number(heightCm);
  const weight = Number(weightKg);
  const podeSalvar = !!birthDate && height > 0 && weight > 0 && !!experience && !isSaving;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!podeSalvar) return;
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveProfile({
        birth_date: birthDate,
        height_cm: height,
        current_weight_kg: weight,
        biological_sex: sex || null,
        injuries_or_limitations: injuries.trim() || null,
        training_experience: experience,
      });
      setSaved(true);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Header title="Meus dados" showBack />
      <form onSubmit={submit} className="space-y-4 px-4 py-5 pb-28">
        <Card>
          <p className="font-bold text-white">{user?.name}</p>
          <p className="text-sm text-zinc-400">{user?.email}</p>
        </Card>

        <Card className="space-y-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Data de nascimento</span>
            <input type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setBirthDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-white" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Altura (cm)</span>
              <input type="number" inputMode="decimal" value={heightCm} onChange={(e) => setHeightCm(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-white" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Peso (kg)</span>
              <input type="number" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-white" />
            </label>
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Sexo biológico</span>
            <div className="mt-2 flex gap-2">
              {SEXOS.map((option) => (
                <button key={option.value} type="button" onClick={() => setSex(option.value)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${sex === option.value ? 'bg-primary-600 text-white' : 'bg-zinc-950 text-zinc-400 ring-1 ring-zinc-800'}`}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Experiência</span>
            <div className="mt-2 flex gap-2">
              {EXPERIENCIAS.map((option) => (
                <button key={option.value} type="button" onClick={() => setExperience(option.value)}
                  className={`flex-1 rounded-xl px-2 py-2 text-xs font-semibold ${experience === option.value ? 'bg-primary-600 text-white' : 'bg-zinc-950 text-zinc-400 ring-1 ring-zinc-800'}`}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Lesões ou limitações</span>
            <textarea value={injuries} onChange={(e) => setInjuries(e.target.value)} rows={3}
              placeholder="Deixe em branco se não houver"
              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-white placeholder:text-zinc-600" />
          </label>
        </Card>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && <p className="text-sm text-emerald-400">Dados salvos.</p>}

        <Button type="submit" fullWidth size="lg" disabled={!podeSalvar} isLoading={isSaving}>Salvar</Button>
        <Button type="button" variant="ghost" fullWidth onClick={() => navigate('/profile')}>Voltar</Button>
      </form>
    </>
  );
}
