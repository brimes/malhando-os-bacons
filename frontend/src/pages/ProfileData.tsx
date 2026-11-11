import { useEffect, useState, type FormEvent } from 'react';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuthStore } from '../stores/useAuthStore';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { getErrorMessage } from '../api/client';
import { Notice, Segmented, SectionTitle, fieldLabel, stagger } from '../components/perfil/ui';
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
      <form onSubmit={submit} className="space-y-[14px] px-5 pb-28 pt-2">
        <div className="enter">
          <Card tint="brand" className="flex items-center gap-4">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-brand">
                <span className="num text-[28px] leading-none text-white">{user?.name?.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[17px] font-bold leading-[1.3] text-fg">{user?.name}</p>
              <p className="text-[15px] text-muted">{user?.email}</p>
            </div>
          </Card>
        </div>

        <section className="enter" style={stagger(1)}>
          <SectionTitle>Corpo</SectionTitle>
          <Card className="space-y-4">
            <label className="block">
              <span className={fieldLabel}>Data de nascimento</span>
              <input type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setBirthDate(e.target.value)}
                className="mt-1.5 w-full min-w-0" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={fieldLabel}>Altura (cm)</span>
                <input type="number" inputMode="decimal" value={heightCm} onChange={(e) => setHeightCm(e.target.value)}
                  className="mt-1.5 w-full min-w-0" />
              </label>
              <label className="block">
                <span className={fieldLabel}>Peso (kg)</span>
                <input type="number" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)}
                  className="mt-1.5 w-full min-w-0" />
              </label>
            </div>

            <div>
              <span className={fieldLabel}>Sexo biológico</span>
              <div className="mt-1.5">
                <Segmented label="Sexo biológico" options={SEXOS} value={sex} onChange={setSex} />
              </div>
            </div>
          </Card>
        </section>

        <section className="enter" style={stagger(2)}>
          <SectionTitle>Treino</SectionTitle>
          <Card className="space-y-4">
            <div>
              <span className={fieldLabel}>Experiência</span>
              <div className="mt-1.5">
                <Segmented label="Experiência" options={EXPERIENCIAS} value={experience} onChange={setExperience} />
              </div>
            </div>
            <label className="block">
              <span className={fieldLabel}>Lesões ou limitações</span>
              <textarea value={injuries} onChange={(e) => setInjuries(e.target.value)} rows={3}
                placeholder="Deixe em branco se não houver"
                className="mt-1.5 w-full" />
            </label>
          </Card>
        </section>

        {error && <Notice tone="danger">{error}</Notice>}
        {saved && <Notice tone="ok">Dados salvos.</Notice>}

        <Button type="submit" fullWidth size="lg" disabled={!podeSalvar} isLoading={isSaving}>Salvar</Button>
      </form>
    </>
  );
}
