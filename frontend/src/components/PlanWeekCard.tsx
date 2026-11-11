import { Card } from './Card';
import { CountUp } from './CountUp';
import { Check } from './treinos/icons';
import type { PlanWeekProgress } from '../lib/planProgress';

// A semana em sete blocos, um por dia: feito em verde com marca, hoje tingido
// da marca, o resto neutro. O que se lê de relance é "quantos já fiz de quantos".

const WEEKDAY_INITIALS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const WEEKDAY_NAMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function PlanWeekCard({ progress }: { progress: PlanWeekProgress }) {
  // Índice 0 é segunda, igual a `weekDays`; getDay() devolve 0 no domingo.
  const todayIndex = (new Date().getDay() + 6) % 7;

  return (
    <Card className="!p-5">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold leading-[1.3] text-fg">Sua semana</h2>
          <p className="mt-0.5 text-[15px] text-muted">
            {progress.target > 0 && progress.done >= progress.target ? 'Meta da semana batida' : 'Treinos feitos até agora'}
          </p>
        </div>
        <p className="num shrink-0 text-[38px] leading-[1.05] text-fg">
          <CountUp value={progress.done} />
          <span className="font-sans text-[17px] font-semibold text-muted"> de {progress.target || 0}</span>
        </p>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {progress.weekDays.map((done, index) => {
          const isToday = index === todayIndex;
          return (
            <div
              key={index}
              aria-label={`${WEEKDAY_NAMES[index]}${done ? ': treino feito' : ': sem treino'}`}
              className={`flex h-14 flex-col items-center justify-center gap-1 rounded-md ${
                done ? 'bg-ok-soft text-ok' : isToday ? 'bg-brand-soft text-brand-fg' : 'bg-surface-2 text-dim'
              }`}
            >
              <span className="text-[13px] font-bold leading-none">{WEEKDAY_INITIALS[index]}</span>
              {done ? <Check className="h-4 w-4" /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
            </div>
          );
        })}
      </div>

      {progress.pendingCount > 0 && (
        <p className="mt-3 text-[13px] leading-[1.4] text-teal">
          {progress.pendingCount} {plural(progress.pendingCount, 'treino contado aqui ainda não foi enviado', 'treinos contados aqui ainda não foram enviados')} ao servidor.
        </p>
      )}
    </Card>
  );
}
