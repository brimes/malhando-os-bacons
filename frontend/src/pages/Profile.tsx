import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { CountUp } from '../components/CountUp';
import { App as CapacitorApp } from '@capacitor/app';
import { DeleteAccountModal } from '../components/DeleteAccountModal';
import { ThemeSelector } from '../components/ThemeSelector';
import { workoutsApi } from '../api/workouts';
import { Chevron, Group, Row, SectionTitle, Skeleton, stagger } from '../components/perfil/ui';
import type { WorkoutStats } from '../types';

const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout, deleteAccount } = useAuthStore();
  const { state, isLoading, resetObjective } = useOnboardingStore();
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [stats, setStats] = useState<WorkoutStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  // A versão vem do pacote instalado, não de um número escrito no código: era
  // isso que fazia toda build dizer "0.1.0" e não dava para saber, olhando o
  // app, se o aparelho tinha a build nova. `getInfo` só responde no app
  // nativo: no navegador a promessa rejeita e a linha muda de texto.
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    CapacitorApp.getInfo()
      .then((info) => setAppVersion(`${info.version} (${info.build})`))
      .catch(() => setAppVersion(''));
  }, []);

  // Estatísticas são enfeite do cabeçalho: se falharem, o bloco some em vez de
  // virar erro numa tela que serve para ajustar a conta.
  useEffect(() => {
    workoutsApi.stats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, []);

  const redefineObjective = async () => {
    if (!window.confirm('Deseja apagar a conversa atual e definir um novo objetivo?')) return;
    await resetObjective();
    navigate('/onboarding');
  };

  const profile = state?.profile;
  const goal = state?.goal;
  const targets: { label: string; value: string; unit: string }[] = [];
  if (goal?.target_weight_kg) targets.push({ label: 'Peso-alvo', value: num(goal.target_weight_kg), unit: 'kg' });
  if (goal?.target_body_fat_percentage) targets.push({ label: 'Gordura alvo', value: num(goal.target_body_fat_percentage), unit: '%' });
  if (goal?.target_muscle_mass_kg) targets.push({ label: 'Massa muscular', value: num(goal.target_muscle_mass_kg), unit: 'kg' });
  if (goal?.target_six_minute_walk_meters) targets.push({ label: 'Caminhada de 6 min', value: String(goal.target_six_minute_walk_meters), unit: 'm' });

  const statItems = stats ? [
    { label: 'Treinos', value: stats.total_workouts, tone: 'text-fg' },
    { label: 'Séries', value: stats.total_sets, tone: 'text-fg' },
    { label: 'Sequência', value: stats.streak_days, tone: 'text-sun' },
  ] : [];

  return (
    <>
      <Header title="Perfil" />
      <div className="space-y-6 px-5 pb-24 pt-2">
        {/* O cartão inteiro abre os dados: o alvo de toque é o cartão, mas mirar
            só no nome num aparelho é frustrante. */}
        <div className="enter">
          <Card onClick={() => navigate('/profile/dados')} tint="brand" className="flex items-center gap-4 !p-5">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-[72px] w-[72px] shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg bg-brand">
                <span className="num text-[36px] leading-none text-white">{user?.name?.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="num break-anywhere text-[28px] leading-[1.05] text-fg">{user?.name}</p>
              <p className="mt-1 break-anywhere text-[15px] leading-[1.35] text-muted">{user?.email}</p>
              {user?.created_at && (
                <div className="mt-2">
                  <Chip>Desde {new Date(user.created_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '')}</Chip>
                </div>
              )}
            </div>
            <Chevron />
          </Card>
        </div>

        {statsLoading && <Skeleton className="h-[92px]" />}
        {!statsLoading && stats && (
          <div className="enter grid grid-cols-3 gap-3" style={stagger(1)}>
            {statItems.map((s) => (
              <Card key={s.label} className="min-w-0 !px-2 !py-4 text-center">
                <p className={`num text-[32px] leading-[1.05] ${s.tone}`}><CountUp value={s.value} format={(n) => n.toLocaleString('pt-BR')} /></p>
                <p className="mt-1 text-[13px] font-semibold text-muted">{s.label}</p>
              </Card>
            ))}
          </div>
        )}

        {goal && (
          <section className="enter" style={stagger(2)}>
            <SectionTitle>Meu objetivo</SectionTitle>
            <Card tint="violet" className="!p-5">
              <p className="text-base leading-[1.5] text-fg">{goal.summary}</p>
              {targets.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
                  {targets.map((t) => (
                    <div key={t.label} className="min-w-0">
                      <p className="num text-[32px] leading-[1.05] text-violet">
                        {t.value}<span className="ml-1 font-sans text-[15px] font-semibold text-muted">{t.unit}</span>
                      </p>
                      <p className="mt-0.5 text-[13px] font-semibold text-muted">{t.label}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {goal.target_date && <Chip tone="violet">Até {longDate(goal.target_date)}</Chip>}
                {goal.conditioning_focus && !goal.target_six_minute_walk_meters && <Chip tone="violet">Foco em condicionamento</Chip>}
              </div>
              {goal.feasibility_warning && (
                <p className="mt-4 rounded-md bg-sun-soft p-3.5 text-[15px] leading-[1.45] text-sun">{goal.feasibility_warning}</p>
              )}
              <Button variant="secondary" fullWidth onClick={redefineObjective} isLoading={isLoading} className="mt-5">
                Redefinir objetivo
              </Button>
            </Card>
            {goal.conditioning_focus && (
              <Group className="mt-3">
                <Row icon="heart" tone="violet" label="Testes de condicionamento" onClick={() => navigate('/fitness-assessment')} />
              </Group>
            )}
          </section>
        )}

        {profile?.training_experience && (
          <section className="enter" style={stagger(3)}>
            <SectionTitle>Perfil de treino</SectionTitle>
            <Group>
              <Row icon="bolt" tone="brand" label="Experiência" value={profile.training_experience === 'beginner' ? 'Iniciante' : 'Experiente'} />
              {profile.training_experience === 'beginner' && profile.adaptation_ends_at && (
                <Row icon="flame" tone="sun" label="Adaptação até" value={longDate(profile.adaptation_ends_at)} />
              )}
              <div className="px-[18px] py-4">
                <p className="text-[13px] font-semibold text-muted">Lesões ou limitações</p>
                <p className="mt-1 text-[15px] leading-[1.45] text-fg">{profile.injuries_or_limitations || 'Nenhuma informada'}</p>
              </div>
            </Group>
          </section>
        )}

        <section className="enter" style={stagger(4)}>
          <SectionTitle>Ajustes</SectionTitle>
          <Group>
            <Row icon="id" tone="brand" label="Meus dados"
              value={profile?.current_weight_kg ? `${num(profile.current_weight_kg)} kg` : undefined}
              onClick={() => navigate('/profile/dados')} />
            <Row icon="gear" tone="brand" label="Configurações do treino" onClick={() => navigate('/settings')} />
            <Row icon="pin" tone="teal" label="Minhas academias" onClick={() => navigate('/gyms')} />
            {/* Atalho para o bloco de IA dentro das configurações. */}
            <Row icon="bot" tone="violet" label="IA e chave de API" onClick={() => navigate('/settings#ia')} />
          </Group>
        </section>

        <section className="enter" style={stagger(5)}>
          <SectionTitle>Aparência</SectionTitle>
          <Card className="!p-3"><ThemeSelector /></Card>
        </section>

        {/* Zona de perigo, separada no fim. Excluir a conta fica visível, e não
            escondido atrás de um e-mail de suporte: a Apple exige o caminho
            dentro do app, e quem quer sair não deveria ter de caçar como. */}
        <section className="enter pt-4" style={stagger(5)}>
          <Group>
            <Row icon="logout" danger label="Sair da conta" onClick={logout} />
            <Row icon="trash" danger label="Excluir minha conta" onClick={() => setDeleteOpen(true)} />
          </Group>
          <p className="mt-5 text-center text-[13px] text-dim">{appVersion ? `MOB versão ${appVersion}` : 'MOB no navegador'}</p>
        </section>
      </div>

      {isDeleteOpen && (
        <DeleteAccountModal
          hasPassword={user?.has_password !== false}
          onClose={() => setDeleteOpen(false)}
          onConfirm={deleteAccount}
        />
      )}
    </>
  );
}
