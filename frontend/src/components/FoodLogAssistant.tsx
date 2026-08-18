import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { nutritionApi } from '../api/nutrition';
import { getErrorMessage } from '../api/client';
import { MEAL_TYPE_LABELS, type NutritionLogAssistantMessage, type NutritionLogDraftEntry } from '../types';

const SUGESTOES = [
  'Comi uma pizza hoje',
  'Almocei arroz, feijão e frango',
  'Tomei um café da manhã reforçado',
];

const formatarData = (valor: string) =>
  new Date(`${valor.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

interface FoodLogAssistantProps {
  /** Grava os registros conferidos. A tela decide para onde ir depois. */
  onRegistrar: (entries: NutritionLogDraftEntry[]) => Promise<void>;
}

/**
 * Modo IA de registrar refeição: a pessoa conta o que comeu, o assistente
 * pergunta o que falta e devolve os registros prontos.
 *
 * A lista proposta NÃO é gravada ao aparecer. Ela é uma estimativa a partir de
 * uma descrição ("uns 3 pedaços"), e como a estimativa por foto, passa pela
 * conferência de quem comeu antes de virar registro — inclusive a data, que o
 * assistente resolveu a partir de "ontem à noite" e é o que mais silenciosamente
 * pode sair errado.
 */
export function FoodLogAssistant({ onRegistrar }: FoodLogAssistantProps) {
  const [messages, setMessages] = useState<NutritionLogAssistantMessage[]>([]);
  const [entries, setEntries] = useState<NutritionLogDraftEntry[] | null>(null);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, isSending, entries]);

  const enviar = async (texto: string) => {
    const pergunta = texto.trim();
    if (!pergunta || isSending) return;

    const conversa: NutritionLogAssistantMessage[] = [...messages, { role: 'user', content: pergunta }];
    setMessages(conversa);
    setDraft('');
    setError(null);
    setIsSending(true);
    try {
      const resposta = await nutritionApi.logAssistant(conversa);
      setMessages([...conversa, { role: 'assistant', content: resposta.reply }]);
      setEntries(resposta.complete ? resposta.entries : null);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      // A pergunta volta para o campo e sai da conversa: reenviar depois com
      // ela pendurada faria o assistente responder duas vezes à mesma frase.
      setMessages(messages);
      setDraft(pergunta);
    } finally {
      setIsSending(false);
    }
  };

  const registrar = async () => {
    if (!entries?.length) return;
    setIsSaving(true);
    setError(null);
    try {
      await onRegistrar(entries);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setIsSaving(false);
    }
  };

  const totalCalorias = Math.round((entries ?? []).reduce((soma, e) => soma + e.calories, 0));

  return (
    <div className="space-y-3">
      {messages.length === 0 && (
        <p className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm leading-relaxed text-zinc-400">
          Conte o que você comeu, do seu jeito. Eu pergunto o que faltar e monto os registros com as calorias e
          os macros — você confere antes de salvar.
        </p>
      )}

      {messages.map((m, i) => (
        <div
          key={i}
          className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            m.role === 'user' ? 'ml-auto bg-primary-700 text-white' : 'border border-zinc-800 bg-zinc-950 text-zinc-200'
          }`}
        >
          {m.content}
        </div>
      ))}

      {isSending && (
        <div className="w-fit rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-500">
          <span className="animate-pulse">pensando...</span>
        </div>
      )}

      {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

      {entries && entries.length > 0 && (
        <div className="rounded-2xl border border-primary-900 bg-primary-950/20 p-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-bold text-white">Vai registrar</h3>
            <span className="text-sm font-bold text-primary-400">{totalCalorias} kcal</span>
          </div>
          <div className="mt-3 space-y-2">
            {entries.map((e, i) => (
              <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium text-white">{e.food_name}</p>
                  <p className="shrink-0 text-sm font-semibold text-primary-400">{Math.round(e.calories)} kcal</p>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {Math.round(e.quantity_g)}g · P:{Math.round(e.protein_g)}g C:{Math.round(e.carbs_g)}g G:{Math.round(e.fat_g)}g
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  {MEAL_TYPE_LABELS[e.meal_type]} · {formatarData(e.date)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">
            Estimativa a partir do que você descreveu. Depois de registrar, dá para ajustar qualquer item no
            histórico.
          </p>
          <Button fullWidth size="lg" className="mt-3" isLoading={isSaving} onClick={registrar}>
            Registrar {entries.length === 1 ? 'alimento' : `${entries.length} alimentos`}
          </Button>
        </div>
      )}

      <div ref={fimRef} />

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGESTOES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={isSending}
              onClick={() => void enviar(s)}
              className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-[11px] text-zinc-300 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void enviar(draft);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={isSending || isSaving}
          rows={1}
          maxLength={1000}
          placeholder="O que você comeu?"
          className="max-h-28 min-h-[48px] flex-1 resize-none rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:border-primary-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isSending || isSaving || draft.trim().length === 0}
          className="h-[48px] shrink-0 rounded-2xl bg-primary-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
