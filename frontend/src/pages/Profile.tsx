import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { state, isLoading, resetObjective } = useOnboardingStore();

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
              className="w-16 h-16 rounded-2xl object-cover"
            />
          ) : (
            <div className="w-16 h-16 bg-primary-700 rounded-2xl flex items-center justify-center">
              <span className="text-2xl font-bold text-white">
                {user?.name?.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-bold text-white text-lg">{user?.name}</p>
            <p className="text-sm text-zinc-400">{user?.email}</p>
            <p className="text-xs text-zinc-600 mt-1">
              Membro desde {user?.created_at
                ? new Date(user.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                : '—'}
            </p>
          </div>
          <span className="shrink-0 text-zinc-600">›</span>
        </Card>

        {state?.profile?.training_experience && (
          <div>
            <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3 px-1">Perfil de treino</h3>
            <Card className="space-y-3">
              <div className="flex items-center justify-between text-sm"><span className="text-zinc-500">Experiência</span><span className="font-medium text-white">{state.profile.training_experience === 'beginner' ? 'Iniciante' : 'Experiente'}</span></div>
              {state.profile.training_experience === 'beginner' && state.profile.adaptation_ends_at && <div className="flex items-center justify-between text-sm"><span className="text-zinc-500">Adaptação até</span><span className="font-medium text-primary-400">{new Date(`${state.profile.adaptation_ends_at.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</span></div>}
              <div className="border-t border-zinc-800 pt-3"><p className="text-xs uppercase tracking-wide text-zinc-600">Lesões ou limitações</p><p className="mt-1 text-sm leading-relaxed text-zinc-300">{state.profile.injuries_or_limitations || 'Nenhuma informada'}</p></div>
            </Card>
          </div>
        )}

        {state?.goal && (
          <div>
            <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3 px-1">Meu objetivo</h3>
            <Card className="border-primary-900 bg-primary-950/30">
              <p className="text-sm leading-relaxed text-zinc-200">{state.goal.summary}</p>
              {state.goal.target_weight_kg && <p className="mt-3 text-xs font-semibold text-primary-400">Peso-alvo: {state.goal.target_weight_kg} kg</p>}
              {state.goal.target_body_fat_percentage && <p className="mt-1 text-xs font-semibold text-primary-400">Gordura corporal alvo: {state.goal.target_body_fat_percentage}%</p>}
              {state.goal.target_muscle_mass_kg && <p className="mt-1 text-xs font-semibold text-primary-400">Massa muscular alvo: {state.goal.target_muscle_mass_kg} kg</p>}
              {state.goal.target_six_minute_walk_meters && <p className="mt-1 text-xs font-semibold text-primary-400">Caminhada de 6 min: {state.goal.target_six_minute_walk_meters} m</p>}
              {state.goal.conditioning_focus && !state.goal.target_six_minute_walk_meters && <p className="mt-1 text-xs font-semibold text-primary-400">Foco em condicionamento físico</p>}
              {state.goal.target_date && <p className="mt-1 text-xs text-zinc-500">Data-meta: {new Date(`${state.goal.target_date.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}</p>}
              {state.goal.feasibility_warning && <p className="mt-3 rounded-xl border border-amber-900 bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-200">{state.goal.feasibility_warning}</p>}
              <Button variant="secondary" fullWidth onClick={redefineObjective} isLoading={isLoading} className="mt-4">
                Redefinir objetivo
              </Button>
              {state.goal.conditioning_focus && <Button variant="ghost" fullWidth onClick={() => navigate('/fitness-assessment')} className="mt-2">Testes de condicionamento</Button>}
            </Card>
          </div>
        )}

        <div>
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3 px-1">Treino</h3>
          <button type="button" onClick={() => navigate('/settings')} className="w-full text-left">
            <Card className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">⚙️</span>
                <div>
                  <p className="text-sm font-medium text-white">Configurações do treino</p>
                  <p className="text-xs text-zinc-500">Contagem para iniciar, vibração e avanço automático</p>
                </div>
              </div>
              <span className="text-zinc-600">›</span>
            </Card>
          </button>
        </div>

        <div>
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3 px-1">Inteligência artificial</h3>
          {/* Deep link to the AI block inside the settings screen. */}
          <button type="button" onClick={() => navigate('/settings#ia')} className="w-full text-left">
            <Card className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">🤖</span>
                <div>
                  <p className="text-sm font-medium text-white">IA e assinatura</p>
                  <p className="text-xs text-zinc-500">Crédito compartilhado, sua própria chave de API ou assinatura</p>
                </div>
              </div>
              <span className="text-zinc-600">›</span>
            </Card>
          </button>
        </div>

        {/* Features */}
        <div>
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3 px-1">Recursos</h3>
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
                  <p className="text-sm font-medium text-white">{f.label}</p>
                  <p className="text-xs text-zinc-500">{f.desc}</p>
                </div>
              </div>
            ))}
          </Card>
        </div>

        {/* Logout */}
        <Button variant="danger" fullWidth onClick={logout} size="lg">
          Sair da conta
        </Button>

        <p className="pt-2 text-center text-xs text-zinc-700">MOB versão 0.1.0</p>
      </div>
    </>
  );
}
