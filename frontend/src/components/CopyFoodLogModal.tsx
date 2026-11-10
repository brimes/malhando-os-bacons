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
 <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={() => !isSaving && onClose()}>
 <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-xl bg-surface shadow-sheet sheet-in p-5" onClick={(event) => event.stopPropagation()}>
 <h3 className="text-lg font-bold text-fg">Copiar para outro dia</h3>
 <p className="mt-1 text-sm leading-relaxed text-muted">
          {log.food_name} · {log.quantity_g}g · {Math.round(log.calories)} kcal
        </p>
 <p className="mt-1 text-xs text-dim">O registro original continua no dia dele.</p>

 {error && <div className="mt-3 rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}

 <label className="mt-4 block text-xs uppercase tracking-wide text-dim">
          Data
          <input
            type="date"
            value={date}
            max={todayLocalDate()}
            disabled={isSaving}
            onChange={(event) => setDate(event.target.value)}
 className="mt-1 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg focus:outline-none disabled:opacity-50"
          />
        </label>

 <div className="mt-4">
 <p className="text-xs uppercase tracking-wide text-dim">Refeição</p>
 <div className="mt-2 grid grid-cols-2 gap-2">
            {MEAL_ORDER.map((meal) => (
              <button
                key={meal}
                type="button"
                disabled={isSaving}
                onClick={() => setMealType(meal)}
 className={`rounded-md border px-3 py-3 text-sm font-medium disabled:opacity-50 ${
                  mealType === meal
                    ? 'border-brand bg-brand-soft text-fg'
                    : 'border-line bg-bg text-muted'
                }`}
              >
                {MEAL_TYPE_LABELS[meal]}
              </button>
            ))}
          </div>
        </div>

 <div className="mt-5 space-y-2">
          <Button fullWidth size="lg" isLoading={isSaving} onClick={submit}>Copiar</Button>
 <button type="button" disabled={isSaving} onClick={onClose} className="w-full py-3 text-sm text-dim disabled:opacity-50">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
