import { ChevronLeft, ChevronRight } from './icons';

interface Props {
  month: Date;
  /** Treinos por dia, chave AAAA-MM-DD. */
  counts: Record<string, number>;
  onMonthChange: (month: Date) => void;
  onDayClick: (date: string) => void;
  selectedDate: string | null;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Calendário de treinos: o dia com treino é um botão de 48 px com o número em
// display; hoje ganha tom da marca e o selecionado vira o botão cheio da marca.
export function TrainingCalendar({ month, counts, onMonthChange, onDayClick, selectedDate }: Props) {
  const year = month.getFullYear();
  const mi = month.getMonth();
  const lead = new Date(year, mi, 1).getDay();
  const total = new Date(year, mi + 1, 0).getDate();
  const now = new Date();
  const todayKey = key(now.getFullYear(), now.getMonth(), now.getDate());
  const cells = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];

  return (
    <div className="rounded-lg bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" aria-label="Mês anterior" onClick={() => onMonthChange(new Date(year, mi - 1, 1))} className="press flex h-12 w-12 items-center justify-center rounded-md bg-surface-2 text-muted">
          <ChevronLeft />
        </button>
        <h2 className="text-[17px] font-bold text-fg">{cap(month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(' de ', ' '))}</h2>
        <button type="button" aria-label="Próximo mês" onClick={() => onMonthChange(new Date(year, mi + 1, 1))} className="press flex h-12 w-12 items-center justify-center rounded-md bg-surface-2 text-muted">
          <ChevronRight />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="pb-1 text-center text-[13px] font-semibold text-dim">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const k = key(year, mi, day);
          const count = counts[k] ?? 0;
          const selected = selectedDate === k;
          const isToday = k === todayKey;
          const tone = selected
            ? 'bg-brand text-white'
            : count > 0
              ? 'bg-brand-soft text-brand-fg'
              : isToday
                ? 'bg-surface-2 text-fg'
                : 'text-muted';
          const inner = (
            <>
              <span className={`num text-[18px] leading-none ${count > 0 || isToday ? '' : 'font-medium'}`}>{day}</span>
              {count > 0 ? (
                <span className="mt-1 flex gap-0.5" aria-hidden="true">
                  {Array.from({ length: Math.min(count, 3) }, (_, n) => <span key={n} className="h-1.5 w-1.5 rounded-full bg-current" />)}
                </span>
              ) : <span className="mt-1 h-1.5" />}
            </>
          );
          const cls = `flex min-h-[52px] w-full flex-col items-center justify-center rounded-md ${tone}`;
          return count > 0 ? (
            <button
              key={k}
              type="button"
              aria-pressed={selected}
              aria-label={`${day}, ${count} ${count === 1 ? 'treino' : 'treinos'}`}
              onClick={() => onDayClick(k)}
              className={`press ${cls}`}
            >
              {inner}
            </button>
          ) : <div key={k} className={cls}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
