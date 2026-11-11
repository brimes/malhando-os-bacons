import { MEAL_TYPE_LABELS, type MealType } from '../../types';

// Seletor de refeição: quatro opções em segmentos de 48 px. Selecionado em teal.
export function MealPicker({ value, onChange }: { value: MealType; onChange: (m: MealType) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1 rounded-md bg-surface-2 p-1" role="tablist" aria-label="Refeição">
      {(Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([type, label]) => (
        <button
          key={type}
          type="button"
          role="tab"
          aria-selected={value === type}
          onClick={() => onChange(type)}
          className={`press min-h-[48px] rounded-sm px-1 text-[13px] font-semibold ${value === type ? 'bg-teal text-on-teal' : 'text-muted'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
