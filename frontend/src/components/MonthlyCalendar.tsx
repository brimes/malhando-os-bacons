interface CalendarValue {
  label: string;
  intensity?: number;
}

interface MonthlyCalendarProps {
  month: Date;
  values: Record<string, CalendarValue>;
  onMonthChange: (month: Date) => void;
}

const weekDays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function MonthlyCalendar({ month, values, onMonthChange }: MonthlyCalendarProps) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const today = new Date();
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const cells = [...Array(firstWeekDay).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-4 flex items-center justify-between">
        <button aria-label="Mês anterior" onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white">‹</button>
        <h2 className="font-bold capitalize text-white">{month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h2>
        <button aria-label="Próximo mês" onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white">›</button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day, index) => <div key={`${day}-${index}`} className="pb-2 text-center text-[10px] font-semibold text-zinc-600">{day}</div>)}
        {cells.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} />;
          const key = dateKey(year, monthIndex, day);
          const value = values[key];
          const intensity = Math.min(Math.max(value?.intensity ?? 0, 0), 1);
          return (
            <div key={key} className={`relative flex min-h-14 flex-col items-center justify-center rounded-xl border ${key === todayKey ? 'border-primary-500' : value ? 'border-primary-800' : 'border-transparent'} ${value ? 'bg-primary-950' : 'bg-zinc-950/40'}`} style={value ? { backgroundColor: `rgb(58 18 14 / ${0.45 + intensity * 0.45})` } : undefined}>
              <span className={`text-xs ${value ? 'font-bold text-primary-200' : 'text-zinc-500'}`}>{day}</span>
              {value && <span className="mt-1 max-w-full truncate px-0.5 text-[9px] font-semibold text-primary-400">{value.label}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
