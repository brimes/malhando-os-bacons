import { useEffect, useRef, useState } from 'react';
import { progressReviewsApi } from '../api/progressReviews';
import { getErrorMessage } from '../api/client';
import type { ProgressReviewMessage } from '../types';

interface ProgressReviewChatProps {
  reviewId: number;
}

// Escolhidas para o que a pessoa realmente faz depois de ler uma avaliação:
// conferir de onde saiu o número, contestar o dado, e saber por onde começar.
const SUGGESTIONS = [
  'De onde saiu esse número?',
  'Treinei mais do que está aí',
  'Por onde eu começo?',
];

/**
 * Conversa sobre a análise, embutida na própria tela em vez de num modal: a
 * pergunta quase sempre nasce de uma frase que está logo acima, e um modal
 * cobriria justamente o texto que a motivou.
 *
 * Responde contra o histórico congelado no momento da análise (o backend guarda
 * `context_snapshot`), não contra os dados de hoje — senão a conversa passaria a
 * discordar do texto que ela está explicando.
 */
export function ProgressReviewChat({ reviewId }: ProgressReviewChatProps) {
  const [messages, setMessages] = useState<ProgressReviewMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let canceled = false;
    progressReviewsApi
      .chat(reviewId)
      .then((history) => {
        if (!canceled) setMessages(history);
      })
      .catch(() => {
        // Uma thread que não carrega não vale um erro vermelho embaixo da
        // análise: a tela continua útil e a primeira pergunta tenta de novo.
      })
      .finally(() => {
        if (!canceled) setIsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [reviewId]);

  useEffect(() => {
    if (messages.length > 0 || isSending) bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, isSending]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || isSending) return;

    setDraft('');
    setError(null);
    setIsSending(true);
    try {
      const answer = await progressReviewsApi.ask(reviewId, question);
      setMessages((current) => [...current, answer.user_message, answer.message]);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      // O rascunho volta para o campo: reescrever a pergunta perdida é o
      // atrito que faz a pessoa desistir de perguntar.
      setDraft(question);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="text-xs uppercase tracking-wide text-zinc-500">Perguntar sobre esta análise</h2>

      {!isLoading && messages.length === 0 && (
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          Discorda de algum número, quer entender a conta ou saber o que fazer primeiro? Pergunte aqui — a
          resposta usa exatamente os dados desta avaliação.
        </p>
      )}

      {messages.length > 0 && (
        <div className="mt-3 space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                message.role === 'user'
                  ? 'ml-auto bg-primary-700 text-white'
                  : 'border border-zinc-800 bg-zinc-950 text-zinc-200'
              }`}
            >
              {message.content}
            </div>
          ))}
        </div>
      )}

      {isSending && (
        <div className="mt-3 w-fit rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-500">
          <span className="animate-pulse">pensando...</span>
        </div>
      )}

      {error && <div className="mt-3 rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

      <div ref={bottomRef} />

      {messages.length === 0 && !isLoading && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={isSending}
              onClick={() => void send(suggestion)}
              className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-[11px] font-medium text-zinc-300 disabled:opacity-50"
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
        className="mt-3 flex items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={isSending}
          rows={1}
          maxLength={1500}
          placeholder="Escreva sua pergunta..."
          className="max-h-28 min-h-[48px] flex-1 resize-none rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-primary-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isSending || draft.trim().length === 0}
          className="h-[48px] shrink-0 rounded-2xl bg-primary-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
