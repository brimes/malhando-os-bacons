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
  // Procedência, não aviso de IA: diz que os números vieram de uma descrição
  // conversada, que é o que a pessoa precisa reconhecer ao reler o histórico.
  assistant: 'Conversa',
  // Diferente das outras: não é uma medição do dia, é a mediana de dias
  // parecidos confirmada com um toque. Precisa ficar claro que é estimativa,
  // não um registro item a item.
  routine: 'Rotina (estimativa)',
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
