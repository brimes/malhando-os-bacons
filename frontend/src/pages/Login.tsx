import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { APPLE_BUNDLE_ID, googleClientIdForPlatform } from '../lib/authConfig';
import { useAuthStore } from '../stores/useAuthStore';

/** Cancelar o seletor nativo não é erro: a pessoa só desistiu. */
function isCancellation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; error?: unknown } | null;
  const text = `${e?.message ?? ''} ${e?.error ?? ''}`.toLowerCase();
  return String(e?.code) === '1001' || String(e?.code) === '12501' || text.includes('cancel');
}

const AppleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.37 12.63c-.03-2.64 2.16-3.9 2.26-3.97-1.23-1.8-3.15-2.05-3.83-2.08-1.63-.16-3.19.96-4.01.96-.83 0-2.1-.94-3.46-.91-1.78.03-3.42 1.03-4.34 2.63-1.85 3.21-.47 7.96 1.33 10.57.88 1.27 1.93 2.7 3.31 2.65 1.33-.05 1.83-.86 3.44-.86 1.6 0 2.06.86 3.46.83 1.43-.03 2.34-1.3 3.21-2.58 1.01-1.48 1.43-2.91 1.45-2.98-.03-.01-2.79-1.07-2.82-4.26zM13.73 4.8c.73-.89 1.22-2.12 1.09-3.35-1.05.04-2.32.7-3.07 1.58-.67.78-1.26 2.04-1.1 3.24 1.17.09 2.35-.6 3.08-1.47z" />
  </svg>
);

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state ?? {}) as { email?: string; notice?: string };
  const { login, register, loginWithGoogle, loginWithApple, clearError, isAuthenticated, isLoading, error } = useAuthStore();
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(routeState.email ?? '');
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

  const googleClientId = Capacitor.isNativePlatform() ? googleClientIdForPlatform() : '';
  const showApple = Capacitor.getPlatform() === 'ios';

  const handleGoogle = async () => {
    clearError();
    try {
      await GoogleAuth.initialize({ clientId: googleClientId, scopes: ['profile', 'email'], grantOfflineAccess: false });
      const result = await GoogleAuth.signIn();
      const idToken = result.authentication?.idToken;
      if (!idToken) throw new Error('Não foi possível obter a identidade do Google.');
      await loginWithGoogle(idToken);
      navigate('/');
    } catch (err) {
      if (isCancellation(err)) return;
      // Erros do servidor já vão para a store; os do plugin nativo não.
      if (!useAuthStore.getState().error) useAuthStore.setState({ error: 'Não foi possível entrar com o Google. Tente novamente.' });
    }
  };

  const handleApple = async () => {
    clearError();
    try {
      const response = await SignInWithApple.authorize({ clientId: APPLE_BUNDLE_ID, redirectURI: '', scopes: 'email name' });
      const { identityToken, authorizationCode, givenName, familyName } = response.response;
      if (!identityToken || !authorizationCode) throw new Error('Resposta incompleta da Apple.');
      const fullName = [givenName, familyName].filter(Boolean).join(' ').trim();
      await loginWithApple({ identityToken, authorizationCode, name: fullName || undefined });
      navigate('/');
    } catch (err) {
      if (isCancellation(err)) return;
      if (!useAuthStore.getState().error) useAuthStore.setState({ error: 'Não foi possível entrar com a Apple. Tente novamente.' });
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
          {routeState.notice && !error && (
            <div className="bg-green-900/30 border border-green-800 rounded-xl p-3 text-green-300 text-sm text-center">
              {routeState.notice}
            </div>
          )}
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-red-300 text-sm text-center">
              {error}
            </div>
          )}

          {(showApple || googleClientId) && (
            <div className="space-y-3">
              {/* A Apple exige que o botão dela não seja menos proeminente que o do Google: fica acima, com o mesmo tamanho. */}
              {showApple && (
                <button
                  type="button"
                  onClick={handleApple}
                  disabled={isLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white bg-black py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <AppleLogo />
                  Entrar com Apple
                </button>
              )}
              {googleClientId && (
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={isLoading}
                  className="w-full rounded-xl border border-zinc-300 bg-white py-3 font-semibold text-zinc-900 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continuar com Google
                </button>
              )}
              <div className="flex items-center gap-3 text-xs text-zinc-600">
                <span className="h-px flex-1 bg-zinc-800" />ou<span className="h-px flex-1 bg-zinc-800" />
              </div>
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

          {!isRegistering && (
            <Link to="/esqueci-senha" className="block w-full text-center text-sm text-zinc-400 hover:text-zinc-200">
              Esqueci minha senha
            </Link>
          )}

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
