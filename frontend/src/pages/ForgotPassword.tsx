import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

const inputClass = 'w-full min-w-0';

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
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-5 py-8 pt-safe pb-safe">
      <div className="w-full max-w-sm min-w-0 space-y-6">
        <div className="enter text-center" style={{ '--i': 0 } as React.CSSProperties}>
          <h1 className="num text-3xl text-fg mb-2">Esqueci minha senha</h1>
          <p className="text-[15px] text-muted">
            {step === 'email' ? 'Informe seu e-mail para receber um código.' : 'Digite o código recebido e escolha a nova senha.'}
          </p>
        </div>

        {error && (
          <div role="alert" className="enter bg-danger-soft rounded-md p-3 text-danger text-sm text-center break-words">{error}</div>
        )}
        {info && !error && (
          <div className="enter bg-surface-2 rounded-md p-3 text-muted text-sm text-center break-words">{info}</div>
        )}

        <Card>
          {step === 'email' ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div>
                <label htmlFor="fp-email" className="block text-sm font-semibold text-muted mb-1.5">E-mail</label>
                <input id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className={inputClass} placeholder="voce@exemplo.com" />
              </div>
              <Button type="submit" size="lg" fullWidth isLoading={busy}>Enviar código</Button>
            </form>
          ) : (
            <form onSubmit={submitReset} className="space-y-4">
              <div>
                <label htmlFor="fp-code" className="block text-sm font-semibold text-muted mb-1.5">Código de 6 dígitos</label>
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
                <label htmlFor="fp-password" className="block text-sm font-semibold text-muted mb-1.5">Nova senha</label>
                <input id="fp-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required minLength={8} maxLength={72} className={inputClass} placeholder="Mínimo de 8 caracteres" />
              </div>
              <Button type="submit" size="lg" fullWidth isLoading={busy}>Redefinir senha</Button>
              <Button type="button" variant="ghost" fullWidth disabled={busy} onClick={() => void sendCode()}>Reenviar código</Button>
            </form>
          )}
        </Card>

        <Link to="/login" className="flex min-h-[48px] items-center justify-center text-sm font-semibold text-brand-fg">Voltar ao login</Link>
      </div>
    </div>
  );
}
