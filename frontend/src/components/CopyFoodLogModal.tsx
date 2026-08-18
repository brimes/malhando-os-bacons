import { useState } from 'react';
import { Button } from './Button';
import { getErrorMessage } from '../api/client';
import { todayLocalDate } from '../lib/date';
import { MEAL_TYPE_LABELS, type FoodLog, type MealType } from '../types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Repete um registro do histórico em outro dia.
 *
 * Não é mover: o registro original fica onde está, e este cria um novo. A
 * regra de que um registro nunca muda de dia (ver EditFoodLogModal, que por
 * isso não tem campo de data) continua valendo — copiar é justamente o
 * caminho que faltava para quem come a mesma coisa de novo e não quer
 * redigitar quantidade e macros.
 *
 * Os macros vão junto exatamente como estão, inclusive os de uma estimativa
 * por foto: o que se está repetindo é a refeição que a pessoa já conferiu uma
 * vez, não uma nova medição.
 */
interface CopyFoodLogModalProps {
  log: FoodLog;
  onClose: () => void;
  onCopy: (date: string, mealType: MealType) => Promise<void>;
}

export function CopyFoodLogModal({ log, onClose, onCopy }: CopyFoodLogModalProps) {
  const [date, setDate] = useState(todayLocalDate);
  const [mealType, setMealType] = useState<MealType>(log.meal_type);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onCopy(date, mealType);
      onClose();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-black/80 backdrop-blur-sm" onClick={() => !isSaving && onClose()}>
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-zinc-900 p-5" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-lg font-bold text-white">Copiar para outro dia</h3>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
          {log.food_name} · {log.quantity_g}g · {Math.round(log.calories)} kcal
        </p>
        <p className="mt-1 text-xs text-zinc-600">O registro original continua no dia dele.</p>

        {error && <div className="mt-3 rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

        <label className="mt-4 block text-xs uppercase tracking-wide text-zinc-500">
          Data
          <input
            type="date"
            value={date}
            max={todayLocalDate()}
            disabled={isSaving}
            onChange={(event) => setDate(event.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-white focus:border-primary-500 focus:outline-none disabled:opacity-50"
          />
        </label>

        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Refeição</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {MEAL_ORDER.map((meal) => (
              <button
                key={meal}
                type="button"
                disabled={isSaving}
                onClick={() => setMealType(meal)}
                className={`rounded-xl border px-3 py-3 text-sm font-medium disabled:opacity-50 ${
                  mealType === meal
                    ? 'border-primary-600 bg-primary-950/40 text-white'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-400'
                }`}
              >
                {MEAL_TYPE_LABELS[meal]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <Button fullWidth size="lg" isLoading={isSaving} onClick={submit}>Copiar</Button>
          <button type="button" disabled={isSaving} onClick={onClose} className="w-full py-3 text-sm text-zinc-500 disabled:opacity-50">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
