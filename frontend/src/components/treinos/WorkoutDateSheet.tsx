import { useState } from 'react';
import { Button } from '../Button';
import { Sheet } from './Sheet';
import { localDay } from '../../lib/workoutDate';

const pad = (n: number) => String(n).padStart(2, '0');

/** Escolhe o dia (e a hora) de um treino já concluído. Sem data futura. */
export function WorkoutDateSheet({ current, onSave, onClose }: {
  current: Date;
  onSave: (date: Date) => void;
  onClose: () => void;
}) {
  const [day, setDay] = useState(localDay(current));
  const [time, setTime] = useState(`${pad(current.getHours())}:${pad(current.getMinutes())}`);
  const now = new Date();
  const today = localDay(now);
  const maxTime = day === today ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : undefined;

  const chosen = new Date(`${day}T${time || '00:00'}:00`);
  const invalid = Number.isNaN(chosen.getTime()) || chosen.getTime() > now.getTime();

  return (
    <Sheet onClose={onClose} label="Alterar data do treino">
      <h2 className="text-[20px] font-bold text-fg">Alterar data</h2>
      <p className="mt-1 text-[15px] leading-[1.45] text-muted">Em que dia foi este treino? A duração continua a mesma.</p>
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
        <label className="block">
          <span className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">Dia</span>
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} className="mt-1.5 h-[52px] w-full rounded-md border-2 border-transparent bg-surface-2 px-4 text-fg focus:border-brand-fg focus:outline-none" />
        </label>
        <label className="block">
          <span className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">Hora</span>
          <input type="time" value={time} max={maxTime} onChange={(e) => setTime(e.target.value)} className="mt-1.5 h-[52px] w-full rounded-md border-2 border-transparent bg-surface-2 px-4 text-fg focus:border-brand-fg focus:outline-none" />
        </label>
      </div>
      {invalid && <p role="alert" className="mt-2 text-[14px] text-danger">Escolha uma data que não esteja no futuro.</p>}
      <div className="mt-5 space-y-3">
        <Button fullWidth size="lg" disabled={invalid} onClick={() => onSave(chosen)}>Salvar data</Button>
        <Button fullWidth size="lg" variant="secondary" onClick={onClose}>Cancelar</Button>
      </div>
    </Sheet>
  );
}
