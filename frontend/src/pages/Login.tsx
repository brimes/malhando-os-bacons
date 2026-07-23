import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';

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
  const { loginWithGoogle, isAuthenticated, isLoading, error } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    // Load Google Identity Services script
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
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

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo / Branding */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-primary-600 rounded-3xl mb-6 shadow-2xl shadow-primary-900">
            <span className="text-4xl">🥓</span>
          </div>
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

        {/* Google Sign-In */}
        <div className="space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-red-300 text-sm text-center">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div id="google-signin-button" className="flex justify-center" />
          )}

          <p className="text-center text-xs text-zinc-600">
            Ao continuar, você concorda com nossos Termos de Uso e Política de Privacidade.
          </p>
        </div>
      </div>
    </div>
  );
}
