import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { App as CapacitorApp } from '@capacitor/app';
import { DeleteAccountModal } from '../components/DeleteAccountModal';
import { ThemeSelector } from '../components/ThemeSelector';

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout, deleteAccount } = useAuthStore();
  const { state, isLoading, resetObjective } = useOnboardingStore();
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  // A versão vem do pacote instalado, não de um número escrito no código: era
  // isso que fazia toda build dizer "0.1.0" e não dava para saber, olhando o
  // app, se o aparelho tinha a build nova. `getInfo` só responde no app
  // nativo — no navegador a promessa rejeita e a linha muda de texto.
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    CapacitorApp.getInfo()
      .then((info) => setAppVersion(`${info.version} (${info.build})`))
      .catch(() => setAppVersion(''));
  }, []);

  const redefineObjective = async () => {
    if (!window.confirm('Deseja apagar a conversa atual e definir um novo objetivo?')) return;
    await resetObjective();
    navigate('/onboarding');
  };

  return (
    <>
      <Header title="Perfil" />
      <div className="px-4 py-6 pb-24 space-y-6">
        {/* User info */}
        {/* O cartão inteiro abre os dados: o alvo de toque é o nome, mas mirar
            só no texto num aparelho é frustrante. */}
        <Card className="flex items-center gap-4" onClick={() => navigate('/profile/dados')}>
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.name}
              className="w-16 h-16 rounded-lg object-cover"
            />
          ) : (
            <div className="w-16 h-16 bg-brand rounded-lg flex items-center justify-center">
              <span className="text-2xl font-bold text-fg">
                {user?.name?.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-bold text-fg text-lg">{user?.name}</p>
            <p className="text-sm text-muted">{user?.email}</p>
            <p className="text-xs text-dim mt-1">
              Membro desde {user?.created_at
                ? new Date(user.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                : '—'}
            </p>
          </div>
          <span className="shrink-0 text-dim">›</span>
        </Card>

        {state?.profile?.training_experience && (
          <div>
            <h3 className="text-xs text-dim uppercase tracking-wide mb-3 px-1">Perfil de treino</h3>
            <Card className="space-y-3">
              <div className="flex items-center justify-between text-sm"><span className="text-muted">Experiência</span><span className="font-medium text-fg">{state.profile.training_experience === 'beginner' ? 'Iniciante' : 'Experiente'}</span></div>
              {state.profile.training_experience === 'beginner' && state.profile.adaptation_ends_at && <div className="flex items-center justify-between text-sm"><span className="text-muted">Adaptação até</span><span className="font-medium text-brand-fg">{new Date(`${state.profile.adaptation_ends_at.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</span></div>}
              <div className="border-t border-line pt-3"><p className="text-xs uppercase tracking-wide text-dim">Lesões ou limitações</p><p className="mt-1 text-sm leading-relaxed text-muted">{state.profile.injuries_or_limitations || 'Nenhuma informada'}</p></div>
            </Card>
          </div>
        )}

        {state?.goal && (
          <div>
            <h3 className="text-xs text-dim uppercase tracking-wide mb-3 px-1">Meu objetivo</h3>
            <Card className="bg-brand-soft">
              <p className="text-sm leading-relaxed text-fg">{state.goal.summary}</p>
              {state.goal.target_weight_kg && <p className="mt-3 text-xs font-semibold text-brand-fg">Peso-alvo: {state.goal.target_weight_kg} kg</p>}
              {state.goal.target_body_fat_percentage && <p className="mt-1 text-xs font-semibold text-brand-fg">Gordura corporal alvo: {state.goal.target_body_fat_percentage}%</p>}
              {state.goal.target_muscle_mass_kg && <p className="mt-1 text-xs font-semibold text-brand-fg">Massa muscular alvo: {state.goal.target_muscle_mass_kg} kg</p>}
              {state.goal.target_six_minute_walk_meters && <p className="mt-1 text-xs font-semibold text-brand-fg">Caminhada de 6 min: {state.goal.target_six_minute_walk_meters} m</p>}
              {state.goal.conditioning_focus && !state.goal.target_six_minute_walk_meters && <p className="mt-1 text-xs font-semibold text-brand-fg">Foco em condicionamento físico</p>}
              {state.goal.target_date && <p className="mt-1 text-xs text-dim">Data-meta: {new Date(`${state.goal.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</p>}
              {state.goal.feasibility_warning && <p className="mt-3 rounded-md bg-sun-soft p-3 text-xs leading-relaxed text-sun">{state.goal.feasibility_warning}</p>}
              <Button variant="secondary" fullWidth onClick={redefineObjective} isLoading={isLoading} className="mt-4">
                Redefinir objetivo
              </Button>
              {state.goal.conditioning_focus && <Button variant="ghost" fullWidth onClick={() => navigate('/fitness-assessment')} className="mt-2">Testes de condicionamento</Button>}
            </Card>
          </div>
        )}

        <div>
          <h3 className="text-xs text-dim uppercase tracking-wide mb-3 px-1">Aparência</h3>
          <ThemeSelector />
        </div>

        <div className="space-y-3">
          <h3 className="text-xs text-dim uppercase tracking-wide mb-3 px-1">Treino</h3>
          <button type="button" onClick={() => navigate('/settings')} className="w-full text-left">
            <Card className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">⚙️</span>
                <div>
                  <p className="text-sm font-medium text-fg">Configurações do treino</p>
                  <p className="text-xs text-dim">Contagem para iniciar, vibração e avanço automático</p>
                </div>
              </div>
              <span className="text-dim">›</span>
            </Card>
          </button>
          <button type="button" onClick={() => navigate('/gyms')} className="w-full text-left">
            <Card className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">🏋️</span>
                <div>
                  <p className="text-sm font-medium text-fg">Minhas academias</p>
                  <p className="text-xs text-dim">Aparelhos disponíveis em cada lugar onde você treina</p>
                </div>
              </div>
              <span className="text-dim">›</span>
            </Card>
          </button>
        </div>

        <div>
          <h3 className="text-xs text-dim uppercase tracking-wide mb-3 px-1">Inteligência artificial</h3>
          {/* Deep link to the AI block inside the settings screen. */}
          <button type="button" onClick={() => navigate('/settings#ia')} className="w-full text-left">
            <Card className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">🤖</span>
                <div>
                  <p className="text-sm font-medium text-fg">IA e assinatura</p>
                  <p className="text-xs text-dim">Crédito compartilhado, sua própria chave de API ou assinatura</p>
                </div>
              </div>
              <span className="text-dim">›</span>
            </Card>
          </button>
        </div>

        {/* Features */}
        <div>
          <h3 className="text-xs text-dim uppercase tracking-wide mb-3 px-1">Recursos</h3>
          <Card className="space-y-3">
            {[
              { icon: '💪', label: 'Registro de treinos', desc: 'Log de exercícios com séries, reps e carga' },
              { icon: '🥗', label: 'Controle nutricional', desc: 'Macros diários com plano personalizado' },
              { icon: '⌚', label: 'Smartwatch', desc: 'Sincronização de passos e dados de saúde' },
              { icon: '📊', label: 'Dashboard', desc: 'Visão geral cruzada de treino e nutrição' },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-3">
                <span className="text-xl">{f.icon}</span>
                <div>
                  <p className="text-sm font-medium text-fg">{f.label}</p>
                  <p className="text-xs text-dim">{f.desc}</p>
                </div>
              </div>
            ))}
          </Card>
        </div>

        {/* Logout */}
        <Button variant="danger" fullWidth onClick={logout} size="lg">
          Sair da conta
        </Button>

        {/* Excluir a conta fica aqui, visível, e não escondido atrás de um
            e-mail de suporte: a Apple exige o caminho dentro do app, e quem
            quer sair não deveria ter de caçar como. */}
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="w-full py-2 text-center text-sm text-muted underline underline-offset-4"
        >
          Excluir minha conta
        </button>

        <p className="pt-2 text-center text-xs text-dim">{appVersion ? `MOB versão ${appVersion}` : 'MOB no navegador'}</p>
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
