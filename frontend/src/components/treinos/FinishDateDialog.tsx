import { Button } from '../Button';
import { Sheet } from './Sheet';
import { formatDayMonth, localDay } from '../../lib/workoutDate';

/**
 * Antes de concluir uma sessão que começou num dia anterior ao de hoje:
 * "foi ontem?". Sim = registra no dia do início; Não = hoje.
 */
export function FinishDateDialog({ startedAt, onChoose, onClose }: {
  startedAt: string | number | Date;
  onChoose: (choice: 'start' | 'today') => void;
  onClose: () => void;
}) {
  const started = new Date(startedAt);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const label = formatDayMonth(started);
  const title = localDay(started) === localDay(yesterday)
    ? `Este treino foi ontem, ${label}?`
    : `Este treino foi em ${label}?`;
  return (
    <Sheet onClose={onClose} label="Data do treino">
      <h2 className="text-[20px] font-bold leading-[1.3] text-fg">{title}</h2>
      <p className="mt-1 text-[15px] leading-[1.45] text-muted">Você começou o treino nesse dia e ele ainda não foi finalizado.</p>
      <div className="mt-5 space-y-3">
        <Button fullWidth size="lg" onClick={() => onChoose('start')}>Sim, foi {label}</Button>
        <Button fullWidth size="lg" variant="secondary" onClick={() => onChoose('today')}>Não, foi hoje</Button>
      </div>
    </Sheet>
  );
}
