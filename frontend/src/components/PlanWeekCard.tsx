import type { PlanWeekProgress } from '../lib/planProgress';

// Weekly progress plus the workout that is due, both computed on the device from
// the cached plan and history. It is rendered by the plans list and by the plan
// detail so the answer to "o que falta essa semana?" is the same on both, with or
// without a connection.

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function toneFor(progress: PlanWeekProgress) {
  if (progress.onTrack) return { border: 'border-emerald-800', bar: 'bg-emerald-500', text: 'text-emerald-300' };
  if (progress.stillPossible) return { border: 'border-primary-800', bar: 'bg-primary-500', text: 'text-primary-300' };
  return { border: 'border-amber-900', bar: 'bg-amber-500', text: 'text-amber-300' };
}

function messageFor(progress: PlanWeekProgress) {
  if (progress.target === 0) return 'Este plano ainda não tem uma meta semanal.';
  if (progress.onTrack) return 'Meta da semana batida. Excelente!';
  const treinos = `${progress.remaining} ${plural(progress.remaining, 'treino', 'treinos')}`;
  const dias = `${progress.daysLeftInWeek} ${plural(progress.daysLeftInWeek, 'dia', 'dias')}`;
  return progress.stillPossible
    ? `Faltam ${treinos} e ainda restam ${dias}. Dá tempo!`
    : `Faltam ${treinos} para ${dias}. Recupere o que der e volte firme na próxima semana.`;
}

function lastDoneLabel(lastDoneAt: number | null) {
  if (lastDoneAt === null) return 'ainda não feito';
  const today = new Date();
  const done = new Date(lastDoneAt);
  const sameDay = done.toDateString() === today.toDateString();
  if (sameDay) return 'feito hoje';
  return `última vez ${done.toLocaleDateString('pt-BR')}`;
}

export function PlanWeekCard({ progress, planName, onStartNext }: {
  progress: PlanWeekProgress;
  planName?: string;
  /** Omitted on the plan detail, where the day list right below is the target. */
  onStartNext?: (dayId: number) => void;
}) {
  const tone = toneFor(progress);
  const percentage = progress.target > 0 ? Math.min(100, Math.round((progress.done / progress.target) * 100)) : 0;
  const next = progress.days.find((entry) => entry.isNext);

  return (
    <div className={`rounded-2xl border ${tone.border} bg-zinc-900 p-4`}>
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Sua semana</p>
        <p className="text-sm font-black text-white">
          {progress.done} de {progress.target || '—'}
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${tone.bar} transition-all`} style={{ width: `${percentage}%` }} />
      </div>
      <p className={`mt-2 text-sm leading-relaxed ${tone.text}`}>{messageFor(progress)}</p>
      {planName && <p className="mt-1 text-xs text-zinc-600">{planName}</p>}

      {progress.pendingCount > 0 && (
        <p className="mt-2 text-[11px] text-sky-300">
          {progress.pendingCount} {plural(progress.pendingCount, 'treino contado aqui ainda não foi enviado', 'treinos contados aqui ainda não foram enviados')} ao servidor.
        </p>
      )}

      {progress.daysUnknown ? (
        <p className="mt-3 rounded-xl bg-zinc-950 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
          Abra este plano uma vez com internet para que o treino da vez fique disponível offline.
        </p>
      ) : next && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary-400">Treino da vez</p>
          {onStartNext && next.day.id ? (
            <button
              type="button"
              onClick={() => onStartNext(next.day.id as number)}
              className="mt-1 flex w-full items-center justify-between gap-3 rounded-xl bg-primary-950/60 px-3 py-3 text-left ring-1 ring-primary-800"
            >
              <span className="min-w-0">
                <span className="block truncate font-bold text-white">{next.day.name}</span>
                <span className="mt-0.5 block truncate text-xs text-zinc-500">
                  {next.day.focus ? `${next.day.focus} · ` : ''}{lastDoneLabel(next.lastDoneAt)}
                </span>
              </span>
              <span className="shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-bold text-white">Iniciar ›</span>
            </button>
          ) : (
            <div className="mt-1">
              <p className="font-bold text-white">{next.day.name}</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {next.day.focus ? `${next.day.focus} · ` : ''}{lastDoneLabel(next.lastDoneAt)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
