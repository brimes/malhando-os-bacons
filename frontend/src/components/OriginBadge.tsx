import { Chip } from './Chip';
import { CameraIcon, ChatIcon, CalendarIcon, FlameIcon, LeafIcon } from './nutricao/icons';
import type { FoodLog } from '../types';

// Procedência como chip, nunca "gerado por IA": o aviso de IA vive só no termo de
// aceite (CLAUDE.md). `manual` não ganha chip. Compartilhado por Nutrition e NutritionHistory.
const ORIGINS: Partial<Record<FoodLog['origin'], { label: string; tone: 'teal' | 'violet' | 'sun' | 'neutral'; icon: React.ReactNode }>> = {
  photo_plate: { label: 'Foto', tone: 'teal', icon: <CameraIcon /> },
  photo_label: { label: 'Foto', tone: 'teal', icon: <CameraIcon /> },
  plan: { label: 'Plano', tone: 'violet', icon: <LeafIcon /> },
  cheat_day: { label: 'Dia do lixo', tone: 'sun', icon: <FlameIcon /> },
  // Procedência: os números vieram de uma descrição conversada.
  assistant: { label: 'Conversa', tone: 'teal', icon: <ChatIcon /> },
  // Mediana de dias parecidos confirmada com um toque: estimativa, não medição.
  routine: { label: 'Rotina, estimativa', tone: 'neutral', icon: <CalendarIcon /> },
};

export function OriginBadge({ origin }: { origin: FoodLog['origin'] }) {
  const o = ORIGINS[origin];
  if (!o) return null;
  return <Chip tone={o.tone} icon={o.icon}>{o.label}</Chip>;
}
