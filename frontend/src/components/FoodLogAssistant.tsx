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
  /**
   * Grava os registros conferidos. A tela decide para onde ir depois.
   * `descricao` é o que a pessoa digitou na conversa (só as mensagens dela,
   * concatenadas) usado pelo fluxo de "Extrapolei hoje" (`Nutrition.tsx`)
   * para levar o relato do excesso como mensagem inicial do dia do lixo.
   */
  onRegistrar: (entries: NutritionLogDraftEntry[], descricao: string) => Promise<void>;
}

/**
 * Modo IA de registrar refeição: a pessoa conta o que comeu, o assistente
 * pergunta o que falta e devolve os registros prontos.
 *
 * A lista proposta NÃO é gravada ao aparecer. Ela é uma estimativa a partir de
 * uma descrição ("uns 3 pedaços"), e como a estimativa por foto, passa pela
 * conferência de quem comeu antes de virar registro inclusive a data, que o
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
      const descricao = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
      await onRegistrar(entries, descricao);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setIsSaving(false);
    }
  };

  const totalCalorias = Math.round((entries ?? []).reduce((soma, e) => soma + e.calories, 0));

  return (
 <div className="space-y-3">
      {messages.length === 0 && (
 <p className="rounded-lg shadow-card bg-surface p-4 text-[15px] leading-relaxed text-muted">
          Conte o que você comeu, do seu jeito. Eu pergunto o que faltar e monto os registros com as calorias e
          os macros você confere antes de salvar.
        </p>
      )}

      {messages.map((m, i) => (
        <div
          key={i}
 className={`max-w-[88%] whitespace-pre-wrap break-anywhere rounded-lg px-4 py-3 text-[15px] leading-relaxed ${
            m.role === 'user' ? 'ml-auto bg-brand text-white' : 'shadow-card bg-surface text-fg'
          }`}
        >
          {m.content}
        </div>
      ))}

      {isSending && (
 <div className="w-fit rounded-lg shadow-card bg-surface px-4 py-3 text-[15px] text-dim">
 <span className="animate-pulse">pensando...</span>
        </div>
      )}

 {error && <div className="rounded-md bg-danger-soft p-3 text-[15px] text-danger">{error}</div>}

      {entries && entries.length > 0 && (
 <div className="rounded-lg bg-teal-soft p-4">
 <div className="flex items-baseline justify-between">
 <h3 className="text-[15px] font-bold text-fg">Vai registrar</h3>
 <span className="text-[15px] font-bold text-teal">{totalCalorias} kcal</span>
          </div>
 <div className="mt-3 space-y-2">
            {entries.map((e, i) => (
 <div key={i} className="rounded-md shadow-card bg-surface p-3">
 <div className="flex items-start justify-between gap-2">
 <p className="min-w-0 flex-1 text-[15px] font-medium text-fg">{e.food_name}</p>
 <p className="shrink-0 text-[15px] font-semibold text-brand-fg">{Math.round(e.calories)} kcal</p>
                </div>
 <p className="mt-1 text-[13px] text-dim">
                  {Math.round(e.quantity_g)}g, P:{Math.round(e.protein_g)}g C:{Math.round(e.carbs_g)}g G:{Math.round(e.fat_g)}g
                </p>
 <p className="mt-1 text-[13px] text-dim">
                  {MEAL_TYPE_LABELS[e.meal_type]}, {formatarData(e.date)}
                </p>
              </div>
            ))}
          </div>
 <p className="mt-3 text-[13px] leading-relaxed text-dim">
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
 className="rounded-full border-2 border-transparent bg-surface-2 min-h-[44px] px-4 py-2 text-[15px] text-fg disabled:opacity-50"
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
 className="max-h-28 min-h-[52px] flex-1 resize-none rounded-md border-2 border-transparent bg-surface-2 px-4 py-3.5 text-base text-fg placeholder:text-dim focus:border-brand-fg focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isSending || isSaving || draft.trim().length === 0}
 className="min-h-[52px] shrink-0 rounded-md bg-brand px-5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
