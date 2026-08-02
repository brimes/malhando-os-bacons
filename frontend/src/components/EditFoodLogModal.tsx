import { useState } from 'react';
import { Button } from './Button';
import { getErrorMessage } from '../api/client';
import { isLocalId } from '../lib/offline';
import { MEAL_TYPE_LABELS, type FoodLog, type MealType, type UpdateFoodLogInput } from '../types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const UNSYNCED_MESSAGE = 'Este item ainda não foi sincronizado. Conecte-se à internet para alterá-lo.';

type MacroField = 'calories' | 'protein' | 'carbs' | 'fat';

// Two decimals, matching round2 on the backend (both round half up for
// non-negative values) — kept identical so a live-rescaled value sent back
// lands within UpdateLog's own float tolerance instead of reading as a hand
// edit and detaching the record from the catalog.
function roundMacro(value: number): number {
  return Math.round(value * 100) / 100;
}

const fieldClass =
  'w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-white focus:border-primary-500 focus:outline-none disabled:opacity-50';
const smallFieldClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 text-center text-sm text-white focus:border-primary-500 focus:outline-none disabled:opacity-50';

/**
 * Full editor for one food log entry — name, meal, quantity and every
 * macro — shared by the diary (Nutrition.tsx) and the calendar's day panel
 * (NutritionHistory.tsx) so the two never drift into two separate editors
 * again (the day panel used to hand-replicate this before). No date field:
 * the app's rule stays that a record never moves between days.
 *
 * `onSave` is left to the caller because the two screens hold today's logs
 * differently — the store's `todayLogs` vs. this panel's local `dayLogs` —
 * and merge/patch the offline cache differently after a successful write.
 * This component only builds the request body and surfaces whatever error
 * `onSave` throws; it does not touch the offline cache itself.
 */
interface EditFoodLogModalProps {
  log: FoodLog;
  onClose: () => void;
  onSave: (id: number, input: UpdateFoodLogInput) => Promise<void>;
}

export function EditFoodLogModal({ log, onClose, onSave }: EditFoodLogModalProps) {
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
  // (otherwise doubling the quantity silently kept the old calories) — but a
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
  // — never from whatever is already on screen — so repeated keystrokes
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

  // Created offline and its POST still queued: the server has never heard of
  // this id, so a PUT to it can only 404 (online) or get rejected as an
  // unsynced dependency (offline) — surfaced up front, form locked, instead
  // of after the person fills everything in and taps Salvar.
  const unsynced = isLocalId(log.id);

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
    if (unsynced || !valid) return;
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
    <div className="fixed inset-0 z-[100] flex items-end bg-black/80 backdrop-blur-sm" onClick={close}>
      <div
        className="flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-3xl bg-zinc-900 p-5 pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-white">Editar registro</h3>
        {unsynced && <p className="mt-2 text-xs text-amber-400">{UNSYNCED_MESSAGE}</p>}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <form onSubmit={handleSubmit} className="mt-3 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-400">Nome</label>
            <input
              type="text"
              value={name}
              disabled={unsynced}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-400">Refeição</label>
            <div className="grid grid-cols-2 gap-2">
              {MEAL_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={unsynced}
                  onClick={() => setMealType(option)}
                  className={`rounded-xl py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                    mealType === option ? 'bg-primary-600 text-white' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {MEAL_TYPE_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-400">Quantidade (g)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={quantity}
                disabled={unsynced}
                onChange={(e) => handleQuantityChange(e.target.value)}
                className={`${fieldClass} text-center`}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wide text-zinc-400">Calorias (kcal)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={calories}
                disabled={unsynced}
                onChange={(e) => handleMacroChange('calories', e.target.value)}
                className={`${fieldClass} text-center`}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Proteína (g)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={protein}
                disabled={unsynced}
                onChange={(e) => handleMacroChange('protein', e.target.value)}
                className={smallFieldClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Carbs (g)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={carbs}
                disabled={unsynced}
                onChange={(e) => handleMacroChange('carbs', e.target.value)}
                className={smallFieldClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Gordura (g)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={fat}
                disabled={unsynced}
                onChange={(e) => handleMacroChange('fat', e.target.value)}
                className={smallFieldClass}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" fullWidth isLoading={isSaving} disabled={unsynced || !valid}>
              Salvar
            </Button>
            <button type="button" onClick={onClose} className="shrink-0 px-3 text-xs text-zinc-500">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
