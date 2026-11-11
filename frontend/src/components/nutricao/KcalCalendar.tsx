import { Card } from '../Card';

interface Value { label: string; intensity?: number }

interface Props {
  month: Date;
  values: Record<string, Value>;
  onMonthChange: (m: Date) => void;
  onDayClick?: (date: string) => void;
  selectedDate?: string | null;
}

const weekDays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const arrow = (d: 'l' | 'r') => (
  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <path d={d === 'l' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
  </svg>
);

// Calendário de calorias: mapa de calor em teal, o dia grande e as kcal em milhares ("1,9k").
export function KcalCalendar({ month, values, onMonthChange, onDayClick, selectedDate }: Props) {
  const year = month.getFullYear();
  const mi = month.getMonth();
  const first = new Date(year, mi, 1).getDay();
  const count = new Date(year, mi + 1, 0).getDate();
  const t = new Date();
  const todayKey = key(t.getFullYear(), t.getMonth(), t.getDate());
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const short = (label: string) => {
    const n = parseInt(label.replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : label;
  };
  return (
    <Card className="!px-3">
      <div className="mb-2 flex items-center justify-between">
        <button aria-label="Mês anterior" onClick={() => onMonthChange(new Date(year, mi - 1, 1))} className="press flex h-12 w-12 items-center justify-center rounded-md text-muted">{arrow('l')}</button>
        <h2 className="num text-[22px] leading-[1.1] text-fg">{(() => { const t = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(' de ', ' '); return t.charAt(0).toUpperCase() + t.slice(1); })()}</h2>
        <button aria-label="Próximo mês" onClick={() => onMonthChange(new Date(year, mi + 1, 1))} className="press flex h-12 w-12 items-center justify-center rounded-md text-muted">{arrow('r')}</button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((d, i) => <div key={`${d}-${i}`} className="pb-1 text-center text-[13px] font-semibold text-dim">{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const k = key(year, mi, day);
          const v = values[k];
          const inten = Math.min(Math.max(v?.intensity ?? 0, 0), 1);
          const sel = selectedDate === k;
          const cls = `relative flex min-h-[52px] w-full min-w-0 flex-col items-center justify-center rounded-sm ${v ? '' : k === todayKey ? 'bg-teal-soft' : 'bg-surface-2'} ${sel ? '!bg-teal' : ''} ${k === todayKey && !sel ? 'outline outline-2 -outline-offset-2 outline-teal' : ''}`;
          const style = v && !sel ? { backgroundColor: `rgb(var(--teal) / ${0.14 + inten * 0.36})` } : undefined;
          const content = (
            <>
              <span className={`num text-[18px] leading-[1.1] ${sel ? 'text-on-teal' : v ? 'text-fg' : k === todayKey ? 'text-teal' : 'text-dim'}`}>{day}</span>
              {v && <span className={`max-w-full truncate px-0.5 text-[12px] font-semibold leading-[1.2] ${sel ? 'text-on-teal' : 'text-fg'}`}>{short(v.label)}</span>}
            </>
          );
          if (onDayClick && v) {
            return <button key={k} type="button" aria-pressed={sel} aria-label={`${day}: ${v.label}`} onClick={() => onDayClick(k)} className={`press ${cls}`} style={style}>{content}</button>;
          }
          return <div key={k} className={cls} style={style}>{content}</div>;
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[13px] text-muted">
        menos
        {[0.14, 0.26, 0.38, 0.5].map((a) => <span key={a} className="h-3 w-5 rounded-chip" style={{ backgroundColor: `rgb(var(--teal) / ${a})` }} />)}
        mais
      </div>
    </Card>
  );
}
