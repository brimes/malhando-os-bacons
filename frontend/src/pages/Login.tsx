import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';


export function LoginPage() {
  const navigate = useNavigate();
  const { login, register, clearError, isAuthenticated, isLoading, error } = useAuthStore();
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (isRegistering) {
        await register(name, email, password);
      } else {
        await login(email, password);
      }
      navigate('/');
    } catch {
      // Error is displayed from the auth store.
    }
  };

  const toggleMode = () => {
    clearError();
    setIsRegistering((current) => !current);
  };

  return (
    // pt-safe/pb-safe aqui porque esta tela não tem Header nem BottomNav, que
    // são quem carrega o inset nas demais. No Android isso passava despercebido:
    // o padding vem do nativo e cobre o app inteiro. No iOS só ganha quem pede,
    // e sem isto o logo fica embaixo da Dynamic Island.
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 pt-safe pb-safe">
      <div className="w-full max-w-sm">
        {/* Logo / Branding */}
        <div className="text-center mb-12">
          <img src="/mob-icon.png" alt="Bacon treinando" className="mx-auto mb-6 h-32 w-32 rounded-3xl object-cover drop-shadow-2xl" />
          <h1 className="text-4xl font-black text-white mb-2">MOB</h1>
          <p className="text-zinc-400 text-lg">Malhando os Bacons</p>
        </div>

        {/* Features list */}
        <div className="space-y-3 mb-10">
          {[
            { icon: '💪', text: 'Registre seus treinos e progresso' },
            { icon: '🥗', text: 'Acompanhe sua nutrição diária' },
            { icon: '⌚', text: 'Integração com smartwatch' },
            { icon: '📊', text: 'Dashboard completo de performance' },
          ].map((f) => (
            <div key={f.text} className="flex items-center gap-3 text-zinc-300">
              <span className="text-2xl">{f.icon}</span>
              <span className="text-sm">{f.text}</span>
            </div>
          ))}
        </div>

        <div className="space-y-5">
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-red-300 text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {isRegistering && (
              <div>
                <label htmlFor="name" className="block text-xs text-zinc-400 mb-1.5">Nome</label>
                <input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  maxLength={100}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-primary-500"
                  placeholder="Seu nome"
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="block text-xs text-zinc-400 mb-1.5">E-mail</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-primary-500"
                placeholder="voce@exemplo.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs text-zinc-400 mb-1.5">Senha</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                required
                minLength={8}
                maxLength={72}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-primary-500"
                placeholder="Mínimo de 8 caracteres"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-xl bg-primary-600 py-3 font-semibold text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Aguarde...' : isRegistering ? 'Criar conta' : 'Entrar'}
            </button>
          </form>

          <button type="button" onClick={toggleMode} className="w-full text-sm text-primary-400 hover:text-primary-300">
            {isRegistering ? 'Já tenho uma conta' : 'Ainda não tenho uma conta'}
          </button>


          <p className="text-center text-xs text-zinc-600">
            Ao continuar, você concorda com nossos Termos de Uso e Política de Privacidade.
          </p>
        </div>
      </div>
    </div>
  );
}
