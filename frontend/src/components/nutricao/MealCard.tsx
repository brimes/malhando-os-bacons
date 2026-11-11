import { Card } from '../Card';
import { OriginBadge } from '../OriginBadge';
import { BulbIcon, PlusIcon, TrashIcon } from './icons';
import type { FoodLog } from '../../types';

// Refeição: cabeçalho com total de kcal à direita; itens em linhas largas (>= 56 px).
export function MealCard({ title, time, logs, onOpenMenu, onAdd, onEdit, onDelete, index = 0 }: {
  title: string;
  time?: string;
  logs: FoodLog[];
  onOpenMenu?: () => void;
  onAdd: () => void;
  onEdit: (log: FoodLog) => void;
  onDelete: (id: number) => void;
  index?: number;
}) {
  const total = logs.reduce((s, l) => s + (l.calories || 0), 0);
  return (
    <div className="enter" style={{ '--i': index } as React.CSSProperties}>
    <Card className="!px-0 !pb-1">
      <div className="flex items-center gap-2 px-[18px]">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-bold leading-[1.3] text-fg">{title}</h3>
          {time && <p className="text-[13px] text-dim">{time}</p>}
        </div>
        {onOpenMenu && (
          <button type="button" onClick={onOpenMenu} aria-label={`Sugestão do plano para ${title.toLowerCase()}`} className="press flex h-12 w-12 items-center justify-center rounded-md text-teal">
            <BulbIcon />
          </button>
        )}
        <p className="num min-w-[64px] text-right text-[24px] leading-[1.1] text-fg">
          {Math.round(total)}<span className="font-sans text-[13px] font-medium text-muted"> kcal</span>
        </p>
      </div>

      {logs.length === 0 ? (
        <button type="button" onClick={onAdd} className="press mx-[18px] mt-1 mb-3 flex min-h-[56px] w-[calc(100%-36px)] items-center gap-3 rounded-md bg-surface-2 px-4 text-left text-[15px] font-semibold text-muted">
          <PlusIcon className="h-5 w-5 text-teal" /> Adicionar alimento
        </button>
      ) : (
        <ul className="mt-1">
          {logs.map((log) => (
            <li key={log.id} className="flex min-h-[64px] items-center gap-1 pl-[18px] pr-2">
              <button type="button" onClick={() => onEdit(log)} className="press flex min-h-[64px] min-w-0 flex-1 items-center gap-3 text-left">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-fg">{log.food_name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                    <span className="num text-[15px] text-muted">{Math.round(log.quantity_g)} g</span>
                    <OriginBadge origin={log.origin} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-[22px] leading-[1.1] text-fg">{Math.round(log.calories)}</p>
                  <p className="text-[13px] text-dim">kcal</p>
                </div>
              </button>
              <button type="button" onClick={() => onDelete(log.id)} aria-label={`Apagar ${log.food_name}`} className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-dim">
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
    </div>
  );
}
