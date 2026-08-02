import type { FoodLog } from '../types';

// A badge of procedence, never "gerado por IA" — the AI disclosure lives only
// in the acceptance terms (see CLAUDE.md), repeating it on every entry would
// just become noise nobody reads. `manual` gets no badge at all.
//
// Shared by Nutrition.tsx (today's diary) and NutritionHistory.tsx (the day
// panel of the calendar) — kept in one place so the two never drift apart.
const ORIGIN_LABELS: Partial<Record<FoodLog['origin'], string>> = {
  photo_plate: 'Foto',
  photo_label: 'Foto',
  plan: 'Plano',
  cheat_day: 'Dia do lixo',
};

export function OriginBadge({ origin }: { origin: FoodLog['origin'] }) {
  const label = ORIGIN_LABELS[origin];
  if (!label) return null;
  return (
    <span className="ml-2 rounded-full bg-zinc-800 px-1.5 py-0.5 align-middle text-[10px] font-medium text-zinc-400">
      {label}
    </span>
  );
}
