import { useState } from 'react';
import { Button } from './Button';
import { getErrorMessage } from '../api/client';
import { MEAL_TYPE_LABELS, type FoodLog, type MealType, type UpdateFoodLogInput } from '../types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

type MacroField = 'calories' | 'protein' | 'carbs' | 'fat';

// Two decimals, matching round2 on the backend (both round half up for
// non-negative values) kept identical so a live-rescaled value sent back
// lands within UpdateLog's own float tolerance instead of reading as a hand
// edit and detaching the record from the catalog.
function roundMacro(value: number): number {
  return Math.round(value * 100) / 100;
}

const fieldClass =
  'w-full rounded-md border-2 border-transparent bg-surface-2 px-4 py-3 text-fg  focus:border-brand-fg focus:outline-none disabled:opacity-50';
const smallFieldClass =
  'w-full rounded-lg border-2 border-transparent bg-surface-2 px-2 min-h-[52px] text-center text-base text-fg  focus:border-brand-fg focus:outline-none disabled:opacity-50';

/**
 * Full editor for one food log entry name, meal, quantity and every
 * macro shared by the diary (Nutrition.tsx) and the calendar's day panel
 * (NutritionHistory.tsx) so the two never drift into two separate editors
 * again (the day panel used to hand-replicate this before). No date field:
 * the app's rule stays that a record never moves between days.
 *
 * A record still waiting to sync (negative id) is editable exactly like a
 * synced one: `onSave` `updateFoodLog` in `lib/local/repo/foodLogs.ts` for
 * both callers today enqueues the edit behind the pending create, and the
 * generalized id-remap (`lib/local/remap.ts`) rewrites it to the real id the
 * moment the create syncs, same mechanism a workout's series already used.
 *
 * `onSave` is left to the caller so this component stays free of the two
 * screens' different local-first read paths; it only builds the request body
 * and surfaces whatever error `onSave` throws.
 */
interface EditFoodLogModalProps {
  log: FoodLog;
  onClose: () => void;
  onSave: (id: number, input: UpdateFoodLogInput) => Promise<void>;
  /**
   * Opcional para não obrigar quem não tem o que fazer com isso. Onde vem
   * preenchido, é o único caminho para apagar um registro que não é de hoje:
   * o `×` da tela do dia só alcança o dia de hoje, e o histórico não tinha
   * nada equivalente buraco que só apareceu quando passou a ser fácil
   * registrar em dia passado (copiar, e o modo IA resolvendo "ontem à noite").
   */
  onDelete?: (id: number) => Promise<void>;
}

export function EditFoodLogModal({ log, onClose, onSave, onDelete }: EditFoodLogModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [name, setName] = useState(log.food_name);
  const [mealType, setMealType] = useState<MealType>(log.meal_type);
  const [quantity, setQuantity] = useState(String(log.quantity_g));
  const [calories, setCalories] = useState(String(log.calories));
  const [protein, setProtein] = useState(String(log.protein_g));
  const [carbs, setCarbs] = useState(String(log.carbs_g));
  const [fat, setFat] = useState(String(log.fat_g));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which macro fields the person has typed into by hand. Quantity edits
  // rescale every macro field live so what's on screen is what gets saved
  // (otherwise doubling the quantity silently kept the old calories) but a
  // field she already corrected by hand must keep her value, not get
  // overwritten by the next quantity keystroke.
  const [touchedMacros, setTouchedMacros] = useState<Record<MacroField, boolean>>({
    calories: false,
    protein: false,
    carbs: false,
    fat: false,
  });
  const macroSetters: Record<MacroField, (value: string) => void> = {
    calories: setCalories,
    protein: setProtein,
    carbs: setCarbs,
    fat: setFat,
  };

  const handleMacroChange = (field: MacroField, value: string) => {
    macroSetters[field](value);
    setTouchedMacros((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  };

  // The rescale always starts from the record's original quantity and macros
  // never from whatever is already on screen so repeated keystrokes
  // don't compound rounding error on top of each other.
  const handleQuantityChange = (value: string) => {
    setQuantity(value);
    const newQuantity = Number(value);
    if (!log.quantity_g || !Number.isFinite(newQuantity) || newQuantity <= 0) return;
    const ratio = newQuantity / log.quantity_g;
    if (!touchedMacros.calories) setCalories(String(roundMacro(log.calories * ratio)));
    if (!touchedMacros.protein) setProtein(String(roundMacro(log.protein_g * ratio)));
    if (!touchedMacros.carbs) setCarbs(String(roundMacro(log.carbs_g * ratio)));
    if (!touchedMacros.fat) setFat(String(roundMacro(log.fat_g * ratio)));
  };

  const quantityNumber = Number(quantity);
  const caloriesNumber = Number(calories);
  const proteinNumber = Number(protein);
  const carbsNumber = Number(carbs);
  const fatNumber = Number(fat);
  const valid =
    name.trim() !== '' &&
    quantityNumber > 0 &&
    caloriesNumber >= 0 &&
    proteinNumber >= 0 &&
    carbsNumber >= 0 &&
    fatNumber >= 0;

  const close = () => {
    if (!isSaving) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSave(log.id, {
        quantity_g: quantityNumber,
        meal_type: mealType,
        food_name: name.trim(),
        calories: caloriesNumber,
        protein_g: proteinNumber,
        carbs_g: carbsNumber,
        fat_g: fatNumber,
      });
      onClose();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
 <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={close}>
      <div
 className="flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-xl bg-surface shadow-sheet sheet-in p-5 pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
 <h3 className="text-lg font-bold text-fg">Editar registro</h3>
 {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}

 <form onSubmit={handleSubmit} className="mt-3 space-y-4">
          <div>
 <label className="mb-1.5 block text-[13px] uppercase tracking-wide text-muted">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
 className={fieldClass}
            />
          </div>

          <div>
 <label className="mb-1.5 block text-[13px] uppercase tracking-wide text-muted">Refeição</label>
 <div className="grid grid-cols-2 gap-2">
              {MEAL_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMealType(option)}
 className={`rounded-md min-h-[48px] text-[15px] font-semibold transition-colors disabled:opacity-50 ${
                    mealType === option ? 'bg-brand text-white' : 'bg-surface-2 text-muted'
                  }`}
                >
                  {MEAL_TYPE_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

 <div className="grid grid-cols-2 gap-3">
            <div>
 <label className="mb-1.5 block text-[13px] uppercase tracking-wide text-muted">Quantidade (g)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={quantity}
                onChange={(e) => handleQuantityChange(e.target.value)}
 className={`${fieldClass} text-center`}
              />
            </div>
            <div>
 <label className="mb-1.5 block text-[13px] uppercase tracking-wide text-muted">Calorias (kcal)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={calories}
                onChange={(e) => handleMacroChange('calories', e.target.value)}
 className={`${fieldClass} text-center`}
              />
            </div>
          </div>

 <div className="grid grid-cols-3 gap-2">
            <div>
 <label className="mb-1 block text-[13px] text-dim">Proteína (g)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={protein}
                onChange={(e) => handleMacroChange('protein', e.target.value)}
 className={smallFieldClass}
              />
            </div>
            <div>
 <label className="mb-1 block text-[13px] text-dim">Carbs (g)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={carbs}
                onChange={(e) => handleMacroChange('carbs', e.target.value)}
 className={smallFieldClass}
              />
            </div>
            <div>
 <label className="mb-1 block text-[13px] text-dim">Gordura (g)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={fat}
                onChange={(e) => handleMacroChange('fat', e.target.value)}
 className={smallFieldClass}
              />
            </div>
          </div>

 <div className="flex items-center gap-2 pt-1">
            <Button type="submit" fullWidth isLoading={isSaving} disabled={!valid}>
              Salvar
            </Button>
 <button type="button" onClick={onClose} className="shrink-0 min-h-[48px] px-4 text-[15px] text-muted">
              Cancelar
            </button>
          </div>

          {onDelete && (
 <div className="border-t border-line pt-3">
              {confirmarExclusao ? (
 <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={async () => {
                      setIsDeleting(true);
                      setError(null);
                      try {
                        await onDelete(log.id);
                        onClose();
                      } catch (deleteError) {
                        setError(getErrorMessage(deleteError));
                        setIsDeleting(false);
                        setConfirmarExclusao(false);
                      }
                    }}
 className="flex-1 rounded-md bg-danger px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-50"
                  >
                    {isDeleting ? 'Apagando...' : 'Apagar de verdade'}
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => setConfirmarExclusao(false)}
 className="shrink-0 min-h-[48px] px-4 text-[15px] text-muted"
                  >
                    Não
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmarExclusao(true)}
 className="w-full min-h-[48px] text-[15px] font-semibold text-danger"
                >
                  Apagar registro
                </button>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
