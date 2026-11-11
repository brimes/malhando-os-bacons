import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { cheatDayApi } from '../api/cheatDay';
import { getErrorMessage } from '../api/client';
import { Chip } from '../components/Chip';
import { ErrorState, SkeletonBlock } from '../components/nutricao/States';
import { FlameIcon } from '../components/nutricao/icons';
import type { CheatDayMessage, CheatDaySession } from '../types';

export function CheatDayPage() {
  const navigate = useNavigate();
  // Vinda de "Extrapolei hoje" (Nutrition.tsx): o relato do excesso já contado
  // ao assistente de registro, para não repetir a mesma descrição duas vezes.
  const location = useLocation();
  const initialMessage = (location.state as { initialMessage?: string } | null)?.initialMessage;
  const sentInitialMessage = useRef(false);
  const [session, setSession] = useState<CheatDaySession | null>(null);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cheatDayApi.get()
      .then(setSession)
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [session?.messages?.length, isSending]);

  // Só dispara uma vez, e só numa conversa vazia: sessão de dia do lixo é
  // única por pessoa (ver CheatDaySession), então chegar aqui com mensagens
  // já existentes significa reabrir uma conversa em andamento, não começar
  // uma nova a partir do relato do excesso.
  useEffect(() => {
    if (isLoading || sentInitialMessage.current || !initialMessage) return;
    if ((session?.messages?.length ?? 0) > 0) return;
    sentInitialMessage.current = true;
    void send(initialMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, session, initialMessage]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || isSending) return;
    setDraft('');
    setError(null);
    setIsSending(true);
    try {
      const updated = await cheatDayApi.sendMessage(content);
      setSession(updated);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setDraft(content);
    } finally {
      setIsSending(false);
    }
  };

  const accept = async () => {
    if (!session) return;
    setIsAccepting(true);
    setError(null);
    try {
      const updated = await cheatDayApi.accept(session.id);
      setSession(updated);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsAccepting(false);
    }
  };

  const discard = async () => {
    if (!session) return;
    try {
      await cheatDayApi.discard(session.id);
    } finally {
      setSession(null);
    }
  };

  const messages: CheatDayMessage[] = session?.messages ?? [];
  const examples = ['Vou a um rodízio de pizza hoje à noite', 'Churrasco com cerveja no almoço', 'Festa de aniversário com bolo e doces'];
  const isAccepted = session?.status === 'accepted';

  return (
    <>
      <Header title="Dia do lixo" showBack />
      <div className="flex min-h-[calc(100vh-64px)] flex-col px-5 pb-24 pt-2">
        <Card tint="sun" className="enter flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-sun-soft text-sun"><FlameIcon /></span>
          <div className="min-w-0">
            <p className="text-[17px] font-bold leading-[1.3] text-fg">Conte o que vem por aí</p>
            <p className="mt-1 text-[15px] leading-[1.45] text-muted">
              A gente pensa junto no tamanho do exagero. Se quiser, monto um ajuste temporário no treino. Sem culpa e sem cortar comida depois.
            </p>
          </div>
        </Card>

        <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
          {isLoading && (
            <div className="space-y-3" aria-busy="true">
              <SkeletonBlock className="h-14 w-[70%]" />
              <SkeletonBlock className="ml-auto h-12 w-[55%]" />
            </div>
          )}

          {!isLoading && messages.length === 0 && !isSending && !error && !isAccepted && (
            <div>
              <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Por exemplo</p>
              <div className="flex flex-col items-start gap-2">
                {examples.map((ex) => (
                  <button key={ex} type="button" onClick={() => setDraft(ex)} className="press min-h-[48px] rounded-chip bg-surface px-4 text-left text-[15px] text-fg shadow-card">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={`${message.id}-${index}`}
              className={`max-w-[88%] whitespace-pre-wrap break-words rounded-lg px-4 py-3 text-base leading-[1.5] ${
                message.role === 'user' ? 'ml-auto bg-brand text-white' : 'bg-surface text-fg shadow-card'
              }`}
            >
              {message.content}
            </div>
          ))}

          {isSending && (
            <div className="w-fit rounded-lg bg-surface px-4 py-3 text-[15px] text-muted shadow-card" aria-live="polite">
              <span className="animate-pulse">Pensando</span>
            </div>
          )}

          {isAccepted && (
            <Card tint="ok">
              <Chip tone="ok">Compensação montada</Chip>
              <p className="mt-3 text-base leading-[1.5] text-fg">{session?.summary}</p>
              {session?.estimated_calories != null && (
                <p className="mt-3 text-[15px] text-muted">Excedente estimado: <span className="num text-[22px] text-sun">{session.estimated_calories}</span> kcal</p>
              )}
              {session?.compensation_plan_id && (
                <Button size="lg" fullWidth className="mt-4" onClick={() => navigate(`/training-plans/${session.compensation_plan_id}`)}>
                  Ver treino de compensação
                </Button>
              )}
            </Card>
          )}

          {error && (messages.length === 0 && !session
            ? <ErrorState message={error} onRetry={() => { setError(null); setIsLoading(true); cheatDayApi.get().then(setSession).catch((e) => setError(getErrorMessage(e))).finally(() => setIsLoading(false)); }} />
            : <div role="alert" className="rounded-md bg-danger/15 p-3 text-[15px] text-danger">{error}</div>)}
          <div ref={bottomRef} />
        </div>

        {!isAccepted && (
          <>
            {messages.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={discard} disabled={isSending || isAccepting}>Descartar</Button>
                <Button tone="sun" variant="tonal" isLoading={isAccepting} onClick={accept} disabled={isSending}>Compensar</Button>
              </div>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send(draft);
              }}
              className="mt-3 flex items-end gap-2"
            >
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={isSending}
                rows={1}
                maxLength={1000}
                placeholder="Ex.: rodízio de pizza"
                className="max-h-28 min-h-[52px] flex-1 resize-none rounded-md border-2 border-transparent bg-surface-2 px-4 py-3.5 text-base text-fg placeholder:text-dim focus:border-brand-fg focus:outline-none disabled:opacity-[.45]"
              />
              <Button type="submit" size="lg" disabled={isSending || draft.trim().length === 0} className="!min-h-[52px] shrink-0">Enviar</Button>
            </form>
          </>
        )}
      </div>
    </>
  );
}
