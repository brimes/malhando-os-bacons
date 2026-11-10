import type { PlanWeekProgress } from '../lib/planProgress';

// A semana em sete blocos, um por dia, preenchidos onde houve treino. Substitui
// o cartão antigo (barra de progresso + frase + treino da vez), que ocupava
// meia tela para dizer o que a faixa diz de relance. O treino da vez passou a
// viver dentro do cartão do plano, junto do que ele descreve.

const WEEKDAY_INITIALS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const WEEKDAY_NAMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function PlanWeekCard({ progress }: { progress: PlanWeekProgress }) {
  // Índice 0 é segunda, igual a `weekDays`; getDay() devolve 0 no domingo.
  const todayIndex = (new Date().getDay() + 6) % 7;

  return (
    <div className="rounded-lg bg-surface shadow-card px-4 py-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-dim">Sua semana</p>
        <p className="text-sm font-black text-fg">
          {progress.done} de {progress.target || '—'}
        </p>
      </div>

      <div className="mt-2 flex gap-1.5">
        {progress.weekDays.map((done, index) => (
          <div
            key={index}
            title={`${WEEKDAY_NAMES[index]}${done ? ' — treino feito' : ''}`}
            aria-label={`${WEEKDAY_NAMES[index]}${done ? ': treino feito' : ': sem treino'}`}
            className={`flex h-9 flex-1 items-center justify-center rounded-lg text-xs font-bold ${
              done
                ? 'bg-brand text-white'
                : index === todayIndex
                  ? 'bg-surface-2 text-muted'
                  : 'bg-surface-2 text-dim'
            }`}
          >
            {done ? (
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              WEEKDAY_INITIALS[index]
            )}
          </div>
        ))}
      </div>

      {progress.pendingCount > 0 && (
        <p className="mt-2 text-xs text-teal">
          {progress.pendingCount} {plural(progress.pendingCount, 'treino contado aqui ainda não foi enviado', 'treinos contados aqui ainda não foram enviados')} ao servidor.
        </p>
      )}
    </div>
  );
}
