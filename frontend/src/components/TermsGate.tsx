import { useCallback, useEffect, useState } from 'react';
import { termsApi } from '../api/terms';
import { getErrorMessage } from '../api/client';
import { hasCache, isConnectivityError, offlineReady, patchCacheLocally, readThrough, resourceKeyForRequest } from '../lib/offline';
import type { TermsStatus } from '../types';

const TERMS_KEY = resourceKeyForRequest('/terms');

interface TermsGateProps {
  /** Only gate authenticated users — the login screen must stay reachable. */
  active: boolean;
  children: React.ReactNode;
}

const TERM_SECTIONS: { icon: string; title: string; text: string }[] = [
  {
    icon: '🤖',
    title: 'Os treinos são criados por inteligência artificial',
    text: 'Os planos de treino, as cargas sugeridas e as orientações do MOB são gerados automaticamente por inteligência artificial. Como toda IA, ela pode errar: sugerir um exercício inadequado para você, uma carga alta demais ou uma explicação incorreta.',
  },
  {
    icon: '🧑‍🏫',
    title: 'Valide com um profissional de educação física',
    text: 'Antes de seguir qualquer plano gerado aqui, mostre-o para um profissional de educação física. Ele conhece o seu corpo, o seu histórico e consegue ajustar o que a IA não tem como saber.',
  },
  {
    icon: '⚠️',
    title: 'Você treina por sua conta e risco',
    text: 'Ao usar o app, você assume a responsabilidade pelo que faz durante o treino. Qualquer lesão, dor ou problema de saúde decorrente dos exercícios é de sua responsabilidade. Se sentir dor, tontura, falta de ar ou qualquer desconforto, pare imediatamente e procure ajuda.',
  },
  {
    icon: '🩺',
    title: 'O app não substitui médico nem profissional',
    text: 'O MOB não faz diagnóstico, não prescreve tratamento e não substitui acompanhamento médico, fisioterapêutico, nutricional ou de educação física. Se você tem alguma condição de saúde, converse com seu médico antes de começar.',
  },
];

export function TermsGate({ active, children }: TermsGateProps) {
  const [status, setStatus] = useState<TermsStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [hasRead, setHasRead] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped by the retry button to re-run the check effect.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!active) {
      setStatus(null);
      setHasRead(false);
      setAcknowledged(false);
      return;
    }
    let canceled = false;
    setIsChecking(true);
    setLoadError(null);
    // Waits for `offlineReady` before touching the cache at all: this effect
    // runs on mount regardless of `useOfflineStore`'s own hydration (nothing
    // upstream gates it on `isHydrated` the way `App.tsx`'s `ProtectedRoute`
    // gates the screens behind it), so reading the cache any earlier can
    // catch it mid-rehydration — a real snapshot from IndexedDB with this
    // device's accepted status is written into memory microtasks later, but
    // this effect had already read the store as empty and moved on to
    // awaiting the network, same as before this cache-first fix existed.
    void offlineReady.then(() => {
      if (canceled) return;
      // Cache-first, same as every other screen in the app (see
      // `readThrough`): a device that already accepted the current terms
      // must not sit on "Carregando..." behind a live round-trip just to be
      // told what it already knows — the original version of this effect
      // awaited `termsApi.get()` directly, which is exactly the "aguarde"
      // bug the local-first slice exists to remove, and it gated *every*
      // protected screen, not just nutrition's.
      setIsChecking(!hasCache(TERMS_KEY));
      void readThrough<TermsStatus>({
        resourceKey: TERMS_KEY,
        fetcher: () => termsApi.get(),
        apply: (data) => {
          if (canceled) return;
          setStatus(data);
          setIsChecking(false);
        },
        onError: (error, hadCache) => {
          if (canceled) return;
          setIsChecking(false);
          // The cached status (if any) is already on screen; a background
          // revalidation failing is silent, same as `useOnboardingStore`.
          if (hadCache) return;
          // Being offline is not consent, but it is also not a reason to lock
          // someone out of a workout they can do without the server. A response
          // from the server, on the other hand, means the check really ran and its
          // failure must not be treated as an acceptance — otherwise a 500 would
          // silently open the app to someone who never agreed to anything.
          if (isConnectivityError(error)) {
            setStatus({ current_version: '', accepted: true });
            return;
          }
          setLoadError('Não foi possível verificar o termo de uso. Verifique sua conexão e tente de novo.');
        },
      });
    });
    return () => {
      canceled = true;
    };
  }, [active, reloadToken]);

  // Detects "scrolled to the end". Also runs on mount via the ref callback so a
  // short screen (tablet/landscape) does not leave the checkbox locked forever.
  const checkScrollEnd = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 32) setHasRead(true);
  }, []);

  const accept = async () => {
    if (!status) return;
    setIsAccepting(true);
    setError(null);
    try {
      await termsApi.accept(status.current_version);
      const accepted = { ...status, accepted: true, accepted_at: new Date().toISOString() };
      setStatus(accepted);
      // Without this, the next cold start reads the pre-acceptance snapshot
      // first (cache-first — see the effect above) and flashes this whole
      // screen again for the instant it takes the background revalidation to
      // correct it.
      patchCacheLocally(TERMS_KEY, accepted);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsAccepting(false);
    }
  };

  if (!active || status?.accepted) return <>{children}</>;

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-8 text-center">
        <p className="text-4xl">📄</p>
        <p className="text-sm leading-relaxed text-zinc-400">{loadError}</p>
        <button
          type="button"
          onClick={() => setReloadToken((value) => value + 1)}
          className="rounded-2xl bg-primary-600 px-6 py-3 text-sm font-bold text-white"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (isChecking || !status) {
    return <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-500">Carregando...</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950" role="dialog" aria-modal="true" aria-labelledby="terms-title">
      <div className="border-b border-zinc-800 px-5 pb-4 pt-safe">
        <div className="pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-400">Antes de começar</p>
          <h1 id="terms-title" className="mt-2 text-2xl font-black leading-tight text-white">
            Leia com atenção
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Para usar o MOB você precisa entender como os treinos são criados e quais são os seus riscos.
          </p>
        </div>
      </div>

      <div
        ref={checkScrollEnd}
        onScroll={(event) => checkScrollEnd(event.currentTarget)}
        className="flex-1 overflow-y-auto px-5 py-5"
      >
        <div className="space-y-4">
          {TERM_SECTIONS.map((section) => (
            <section key={section.title} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-start gap-3">
                <span className="text-xl leading-none">{section.icon}</span>
                <div>
                  <h2 className="text-sm font-bold text-white">{section.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">{section.text}</p>
                </div>
              </div>
            </section>
          ))}
        </div>

        <p className="mt-5 text-center text-xs leading-relaxed text-zinc-600">
          Em resumo: a IA ajuda, mas quem cuida de você é você e o seu profissional de confiança.
          {status.current_version && ` Versão do termo: ${status.current_version}.`}
        </p>

        {!hasRead && (
          <p className="mt-4 animate-pulse text-center text-xs font-semibold text-primary-400">
            ↓ Role até o fim para liberar o aceite
          </p>
        )}
      </div>

      <div className="border-t border-zinc-800 bg-zinc-950 px-5 pb-safe pt-4">
        <div className="pb-4">
          {error && (
            <div className="mb-3 rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>
          )}

          <button
            type="button"
            disabled={!hasRead}
            onClick={() => setAcknowledged((current) => !current)}
            className="flex w-full items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-left disabled:opacity-50"
          >
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm font-bold transition-colors ${
                acknowledged ? 'border-primary-500 bg-primary-600 text-white' : 'border-zinc-600 bg-zinc-950 text-transparent'
              }`}
              aria-hidden="true"
            >
              ✓
            </span>
            <span className="text-sm leading-relaxed text-zinc-200">
              Estou ciente de que os treinos são gerados por IA, que devo validar com um profissional de educação física
              e que treino por minha conta e risco.
            </span>
          </button>

          <button
            type="button"
            disabled={!hasRead || !acknowledged || isAccepting}
            onClick={accept}
            className="mt-3 w-full rounded-2xl bg-primary-600 py-4 text-base font-semibold text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAccepting ? 'Salvando...' : 'Li, entendi e aceito'}
          </button>
        </div>
      </div>
    </div>
  );
}
