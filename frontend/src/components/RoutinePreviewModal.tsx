import { useMemo, useState } from 'react';
import { Button } from './Button';
import { getErrorMessage } from '../api/client';
import { MEAL_TYPE_LABELS, type NutritionRoutineItem, type NutritionRoutineMeal } from '../types';

/**
 * Pré-visualização do "dia normal" antes de virar registro — usada tanto por
 * "Foi um dia normal" (hoje) quanto por cada linha de "dias esquecidos"
 * (`Nutrition.tsx`), sempre sobre a mesma rotina destilada, só com o rótulo
 * do dia mudando. Remover um item aqui nunca toca `meals`: o que é gravado
 * (`onConfirm`) é o resultado filtrado, a rotina em si continua intacta para
 * a próxima vez que a tela precisar dela.
 */
interface RoutinePreviewModalProps {
  dateLabel: string;
  meals: NutritionRoutineMeal[];
  onClose: () => void;
  onConfirm: (meals: NutritionRoutineMeal[]) => Promise<void>;
}

function itemKey(mealType: string, item: NutritionRoutineItem): string {
  return `${mealType}:${item.food_item_id ?? item.food_name}`;
}

export function RoutinePreviewModal({ dateLabel, meals, onClose, onConfirm }: RoutinePreviewModalProps) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingMeals = useMemo(
    () =>
      meals
        .map((meal) => ({ ...meal, items: meal.items.filter((item) => !removed.has(itemKey(meal.meal_type, item))) }))
        .filter((meal) => meal.items.length > 0),
    [meals, removed]
  );
  const totalCalories = remainingMeals.reduce(
    (sum, meal) => sum + meal.items.reduce((s, item) => s + item.calories, 0),
    0
  );

  const toggleRemoved = (key: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const confirm = async () => {
    if (remainingMeals.length === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      await onConfirm(remainingMeals);
      onClose();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={() => !isSaving && onClose()}>
      <div
        className="flex max-h-[88vh] w-full flex-col overflow-y-auto rounded-t-xl bg-surface shadow-sheet sheet-in p-5 pb-safe"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-fg">Dia normal — {dateLabel}</h3>
        <p className="mt-1 text-xs leading-relaxed text-dim">
          Estimativa a partir do que você costuma comer. Remova o que não bate antes de confirmar.
        </p>

        <div className="mt-4 space-y-4">
          {meals.map((meal) => (
            <div key={meal.meal_type}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-dim">
                {MEAL_TYPE_LABELS[meal.meal_type]}
              </h4>
              <div className="mt-2 space-y-2">
                {meal.items.map((item) => {
                  const key = itemKey(meal.meal_type, item);
                  const isRemoved = removed.has(key);
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between gap-2 rounded-md bg-surface-2 p-3 ${
                        isRemoved ? 'opacity-40' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium text-fg ${isRemoved ? 'line-through' : ''}`}>
                          {item.food_name}
                        </p>
                        <p className="text-xs text-dim">
                          {item.quantity_g}g · {Math.round(item.calories)} kcal · em {item.days_seen} de{' '}
                          {item.days_considered} dias
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => toggleRemoved(key)}
                        className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted disabled:opacity-50"
                      >
                        {isRemoved ? 'Voltar' : 'Remover'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-sm text-muted">Total</span>
          <span className="text-sm font-bold text-brand-fg">{Math.round(totalCalories)} kcal</span>
        </div>

        {error && <div className="mt-3 rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}

        <div className="mt-5 space-y-2">
          <Button fullWidth size="lg" isLoading={isSaving} disabled={remainingMeals.length === 0} onClick={confirm}>
            Confirmar {dateLabel}
          </Button>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="w-full py-3 text-sm text-muted disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
