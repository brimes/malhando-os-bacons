import { useState } from 'react';
import { Button } from './Button';
import { getErrorMessage } from '../api/client';

/**
 * Exclusão da conta, pedida de dentro do app.
 *
 * A Apple exige esse caminho de quem deixa criar conta (5.1.1(v)), e a LGPD
 * exige que ele apague de verdade — o servidor derruba a linha de `users` e a
 * cascata leva plano, treinos, séries, refeições e conversas junto.
 *
 * Por isso as duas travas. A senha é pedida de novo porque a ameaça real é o
 * aparelho desbloqueado na mão de outra pessoa, com a sessão aberta; conta
 * criada pelo Google não tem senha para pedir, e aí a confirmação escrita é o
 * que sobra. Nenhuma das duas existe para desencorajar quem realmente quer
 * sair: a Apple recusa fluxo que dificulta a saída, e esconder o botão seria
 * isso.
 */
interface DeleteAccountModalProps {
  /** Conta do Google não tem senha: a confirmação escrita fica sozinha. */
  hasPassword: boolean;
  onClose: () => void;
  onConfirm: (password: string) => Promise<void>;
}

const CONFIRMATION = 'APAGAR';

export function DeleteAccountModal({ hasPassword, onClose, onConfirm }: DeleteAccountModalProps) {
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = typed.trim().toUpperCase() === CONFIRMATION && (!hasPassword || password.length > 0);

  const submit = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm(password);
      // Não há onClose aqui: apagar a conta desmonta a tela junto com a sessão.
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end bg-black/80 backdrop-blur-sm"
      onClick={() => !isDeleting && onClose()}
    >
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-zinc-900 p-5"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Excluir minha conta"
      >
        <h3 className="text-lg font-bold text-white">Excluir minha conta</h3>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Isto apaga a sua conta e tudo que está nela, no aparelho e no servidor:
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-zinc-300">
          {[
            'Perfil, objetivo e medições',
            'Planos de treino, treinos feitos e cargas registradas',
            'Plano alimentar, refeições registradas e fotos',
            'Conversas com a IA',
          ].map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-red-400">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-xl border border-red-900 bg-red-950/30 p-3 text-xs font-semibold leading-relaxed text-red-200">
          A exclusão é imediata e não tem como desfazer. Não há backup para restaurar depois.
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>
        )}

        {hasPassword && (
          <label className="mt-4 block text-xs uppercase tracking-wide text-zinc-500">
            Sua senha
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-base text-white"
            />
          </label>
        )}

        <label className="mt-4 block text-xs uppercase tracking-wide text-zinc-500">
          Digite {CONFIRMATION} para confirmar
          <input
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-base text-white"
          />
        </label>

        <Button
          fullWidth
          size="lg"
          variant="danger"
          className="mt-5"
          disabled={!ready}
          isLoading={isDeleting}
          onClick={submit}
        >
          Excluir definitivamente
        </Button>
        <button type="button" onClick={onClose} disabled={isDeleting} className="mt-2 w-full py-3 text-sm text-zinc-500">
          Cancelar
        </button>
      </div>
    </div>
  );
}
