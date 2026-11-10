import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { cheatDayApi } from '../api/cheatDay';
import { getErrorMessage } from '../api/client';
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
  }, [session?.messages.length, isSending]);

  // Só dispara uma vez, e só numa conversa vazia: sessão de dia do lixo é
  // única por pessoa (ver CheatDaySession), então chegar aqui com mensagens
  // já existentes significa reabrir uma conversa em andamento, não começar
  // uma nova a partir do relato do excesso.
  useEffect(() => {
    if (isLoading || sentInitialMessage.current || !initialMessage) return;
    if ((session?.messages.length ?? 0) > 0) return;
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
  const isAccepted = session?.status === 'accepted';

  return (
    <>
      <Header title="Dia do lixo" showBack />
 <div className="flex min-h-[calc(100vh-64px)] flex-col px-4 py-4 pb-24">
 <Card className="border-brand bg-brand-soft">
 <p className="text-sm leading-relaxed text-brand-fg">
            Conta pra mim o que você está planejando comer hoje. A gente pensa junto no tamanho do exagero e,
            se você quiser, eu monto um ajuste temporário no treino para compensar — sem culpa e sem cortar
            comida depois.
          </p>
        </Card>

 <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
 {isLoading && <p className="text-sm text-dim">Carregando...</p>}

          {messages.map((message, index) => (
            <div
              key={`${message.id}-${index}`}
 className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-relaxed ${
                message.role === 'user' ? 'ml-auto bg-brand text-white' : 'shadow-card bg-bg text-fg'
              }`}
            >
              {message.content}
            </div>
          ))}

          {isSending && (
 <div className="w-fit rounded-lg shadow-card bg-bg px-4 py-3 text-sm text-dim">
 <span className="animate-pulse">digitando...</span>
            </div>
          )}

          {isAccepted && (
 <Card className="border-brand bg-brand-soft">
 <p className="text-sm font-semibold text-fg">Compensação montada</p>
 <p className="mt-2 text-xs leading-relaxed text-fg">{session?.summary}</p>
              {session?.estimated_calories != null && (
 <p className="mt-2 text-xs text-dim">Excedente estimado: ~{session.estimated_calories} kcal</p>
              )}
              {session?.compensation_plan_id && (
 <Button size="sm" className="mt-3" onClick={() => navigate(`/training-plans/${session.compensation_plan_id}`)}>
                  Ver treino de compensação
                </Button>
              )}
            </Card>
          )}

 {error && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}
          <div ref={bottomRef} />
        </div>

        {!isAccepted && (
          <>
            {messages.length > 0 && (
 <div className="mt-3 flex gap-2">
                <Button variant="secondary" size="sm" onClick={discard} disabled={isSending || isAccepting}>
                  Descartar
                </Button>
                <Button size="sm" isLoading={isAccepting} onClick={accept} disabled={isSending}>
                  Pedir compensação
                </Button>
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
                placeholder="Ex: vou num rodízio de pizza hoje à noite..."
 className="max-h-28 min-h-[52px] flex-1 resize-none rounded-lg shadow-card bg-bg px-4 py-3.5 text-sm text-fg placeholder-dim focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isSending || draft.trim().length === 0}
 className="h-[52px] shrink-0 rounded-lg bg-brand px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Enviar
              </button>
            </form>
          </>
        )}
      </div>
    </>
  );
}
