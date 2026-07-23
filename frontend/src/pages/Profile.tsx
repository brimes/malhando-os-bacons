import { useAuthStore } from '../stores/useAuthStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';

export function ProfilePage() {
  const { user, logout } = useAuthStore();

  return (
    <>
      <Header title="Perfil" />
      <div className="px-4 py-6 pb-24 space-y-6">
        {/* User info */}
        <Card className="flex items-center gap-4">
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
          <div>
            <p className="font-bold text-white text-lg">{user?.name}</p>
            <p className="text-sm text-zinc-400">{user?.email}</p>
            <p className="text-xs text-zinc-600 mt-1">
              Membro desde {user?.created_at
                ? new Date(user.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                : '—'}
            </p>
          </div>
        </Card>

        {/* App info */}
        <div>
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3 px-1">Sobre o app</h3>
          <Card className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Versão</span>
              <span className="text-white">0.1.0</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Stack</span>
              <span className="text-white">Go + React + Kotlin</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Watch</span>
              <span className="text-white">Galaxy Watch 7</span>
            </div>
          </Card>
        </div>

        {/* Features */}
        <div>
          <h3 className="text-xs text-zinc-500 uppercase tracking-wide mb-3 px-1">Recursos</h3>
          <Card className="space-y-3">
            {[
              { icon: '💪', label: 'Registro de treinos', desc: 'Log de exercícios com séries, reps e carga' },
              { icon: '🥗', label: 'Controle nutricional', desc: 'Macros diários com plano personalizado' },
              { icon: '⌚', label: 'Galaxy Watch 7', desc: 'Sincronização de passos e dados de saúde' },
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
      </div>
    </>
  );
}
