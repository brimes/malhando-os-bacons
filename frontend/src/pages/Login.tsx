import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';

const googleClientID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: object) => void;
          renderButton: (element: HTMLElement, config: object) => void;
          prompt: () => void;
        };
      };
    };
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const { login, register, loginWithGoogle, clearError, isAuthenticated, isLoading, error } = useAuthStore();
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!googleClientID) return;

    // Load Google Identity Services script
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: googleClientID,
        callback: async (response: { credential: string }) => {
          try {
            await loginWithGoogle(response.credential);
            navigate('/');
          } catch {
            // Error handled by store
          }
        },
      });

      const buttonEl = document.getElementById('google-signin-button');
      if (buttonEl) {
        window.google?.accounts.id.renderButton(buttonEl, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          locale: 'pt-BR',
        });
      }
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, [loginWithGoogle, navigate]);

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
            { icon: '⌚', text: 'Sincronize com Galaxy Watch 7' },
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

          <div className="flex items-center gap-3 text-xs text-zinc-600">
            <span className="h-px flex-1 bg-zinc-800" />
            <span>ou continue com</span>
            <span className="h-px flex-1 bg-zinc-800" />
          </div>

          {googleClientID ? (
            <div id="google-signin-button" className="flex justify-center" />
          ) : (
            <div className="rounded-xl border border-zinc-800 px-4 py-3 text-center text-xs text-zinc-500">
              Login com Google aguardando configuração OAuth
            </div>
          )}

          <p className="text-center text-xs text-zinc-600">
            Ao continuar, você concorda com nossos Termos de Uso e Política de Privacidade.
          </p>
        </div>
      </div>
    </div>
  );
}
