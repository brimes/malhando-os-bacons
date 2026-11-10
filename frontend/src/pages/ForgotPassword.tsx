import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

const inputClass =
  'w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-primary-500';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const sendCode = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await authApi.forgotPassword(email.trim());
      setInfo('Se esse e-mail estiver cadastrado, enviamos um código de 6 dígitos. Ele expira em pouco tempo.');
      setStep('reset');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const message = await authApi.resetPassword(email.trim(), code, newPassword);
      navigate('/login', { replace: true, state: { email: email.trim(), notice: message || 'Senha redefinida. Entre com a nova senha.' } });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 pt-safe pb-safe">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <h1 className="text-2xl font-black text-white mb-1">Esqueci minha senha</h1>
          <p className="text-sm text-zinc-400">
            {step === 'email' ? 'Informe seu e-mail para receber um código.' : 'Digite o código recebido e escolha a nova senha.'}
          </p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-red-300 text-sm text-center">{error}</div>
        )}
        {info && !error && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-zinc-300 text-sm text-center">{info}</div>
        )}

        <Card>
          {step === 'email' ? (
            <form onSubmit={sendCode} className="space-y-3">
              <div>
                <label htmlFor="fp-email" className="block text-xs text-zinc-400 mb-1.5">E-mail</label>
                <input id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className={inputClass} placeholder="voce@exemplo.com" />
              </div>
              <Button type="submit" fullWidth isLoading={busy}>Enviar código</Button>
            </form>
          ) : (
            <form onSubmit={submitReset} className="space-y-3">
              <div>
                <label htmlFor="fp-code" className="block text-xs text-zinc-400 mb-1.5">Código de 6 dígitos</label>
                <input
                  id="fp-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  className={inputClass}
                  placeholder="000000"
                />
              </div>
              <div>
                <label htmlFor="fp-password" className="block text-xs text-zinc-400 mb-1.5">Nova senha</label>
                <input id="fp-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required minLength={8} maxLength={72} className={inputClass} placeholder="Mínimo de 8 caracteres" />
              </div>
              <Button type="submit" fullWidth isLoading={busy}>Redefinir senha</Button>
              <Button type="button" variant="ghost" fullWidth disabled={busy} onClick={() => void sendCode()}>Reenviar código</Button>
            </form>
          )}
        </Card>

        <Link to="/login" className="block text-center text-sm text-primary-400 hover:text-primary-300">Voltar ao login</Link>
      </div>
    </div>
  );
}
