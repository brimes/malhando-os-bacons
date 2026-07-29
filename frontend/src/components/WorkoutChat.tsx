import { useEffect, useRef, useState } from 'react';
import { workoutChatApi } from '../api/workoutChat';
import { getErrorMessage } from '../api/client';
import type { WorkoutChatMessage } from '../types';

interface WorkoutChatProps {
  workoutId: number;
  /** Controlled visibility. Defaults to open so `<WorkoutChat workoutId={id} onClose={...} />` just works. */
  open?: boolean;
  onClose: () => void;
  /** Optional context appended to the question, e.g. the exercise being executed. */
  exerciseName?: string;
}

const SUGGESTIONS = [
  'Esse exercício está certo?',
  'Posso trocar por outro?',
  'Estou sentindo dor, o que faço?',
];

/**
 * Online detection lives here on purpose: the chat needs the network and must not
 * depend on the shared offline layer being wired up.
 */
function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}

export function WorkoutChat({ workoutId, open = true, onClose, exerciseName }: WorkoutChatProps) {
  const isOnline = useIsOnline();
  const [messages, setMessages] = useState<WorkoutChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !isOnline) return;
    let canceled = false;
    setIsLoading(true);
    setError(null);
    workoutChatApi.history(workoutId)
      .then((history) => {
        if (!canceled) setMessages(history);
      })
      .catch((requestError) => {
        if (!canceled) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!canceled) setIsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [open, workoutId, isOnline]);

  // Keep the newest message visible while the history grows or the assistant types.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isSending, open]);

  if (!open) return null;

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || isSending || !isOnline) return;

    setDraft('');
    setError(null);
    setIsSending(true);
    // Optimistic echo so the person sees the question immediately, mid-workout.
    setMessages((current) => [...current, { role: 'user', content: question, created_at: new Date().toISOString() }]);

    try {
      const contextual = exerciseName ? `(Exercício atual: ${exerciseName}) ${question}` : question;
      const answer = await workoutChatApi.send(workoutId, contextual);
      setMessages((current) => [...current, answer]);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      // Drop the optimistic message so the person can retry without duplicates.
      setMessages((current) => current.slice(0, -1));
      setDraft(question);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full flex-col rounded-t-3xl bg-zinc-900 p-5 pb-safe"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Tirar dúvida sobre o treino"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Tirar dúvida</h3>
            {/* No AI disclaimer here on purpose: the terms gate already covers
                it once, up front. Repeating it on every screen turns a warning
                that matters into noise people stop reading. */}
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              {exerciseName ? `Sobre ${exerciseName}.` : 'Sobre o treino de agora.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="-mr-1 -mt-1 p-2 text-2xl leading-none text-zinc-500">
            ×
          </button>
        </div>

        {!isOnline && (
          <div className="mt-4 rounded-2xl border border-amber-900 bg-amber-950/30 p-4">
            <p className="text-sm font-semibold text-amber-200">Sem internet</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
              Tirar dúvidas precisa de conexão, porque a resposta é gerada na hora. Conecte-se ao Wi-Fi ou aos dados
              móveis e tente de novo. Seu treino continua funcionando normalmente offline.
            </p>
          </div>
        )}

        <div className="-mx-1 mt-4 flex-1 space-y-3 overflow-y-auto px-1">
          {isLoading && <p className="text-sm text-zinc-500">Carregando conversa...</p>}

          {!isLoading && isOnline && messages.length === 0 && (
            <p className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm leading-relaxed text-zinc-400">
              Ficou na dúvida sobre a execução, a carga ou algum incômodo? Pergunte aqui. Se sentir dor forte, pare o
              treino e procure um profissional.
            </p>
          )}

          {messages.map((message, index) => (
            <div
              key={`${message.created_at}-${index}`}
              className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                message.role === 'user'
                  ? 'ml-auto bg-primary-700 text-white'
                  : 'border border-zinc-800 bg-zinc-950 text-zinc-200'
              }`}
            >
              {message.content}
            </div>
          ))}

          {isSending && (
            <div className="w-fit rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-500">
              <span className="animate-pulse">digitando...</span>
            </div>
          )}

          {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

          <div ref={bottomRef} />
        </div>

        {isOnline && messages.length === 0 && !isLoading && (
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={isSending}
                onClick={() => send(suggestion)}
                className="rounded-full border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-xs font-medium text-zinc-300 disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
          className="mt-3 flex items-end gap-2 pb-4"
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!isOnline || isSending}
            rows={1}
            maxLength={400}
            placeholder={isOnline ? 'Digite sua dúvida...' : 'Disponível apenas com internet'}
            className="max-h-28 min-h-[52px] flex-1 resize-none rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3.5 text-sm text-white placeholder-zinc-600 focus:border-primary-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!isOnline || isSending || draft.trim().length === 0}
            className="h-[52px] shrink-0 rounded-2xl bg-primary-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
