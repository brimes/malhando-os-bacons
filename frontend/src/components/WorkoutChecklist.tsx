import { Card } from './Card';
import type { TrainingPlanExercise } from '../types';

export interface ChecklistEntry {
  setsDone: number;
  weight: string;
}

export type ChecklistState = Record<number, ChecklistEntry>;

function formatTarget(exercise: TrainingPlanExercise) {
  if (exercise.tracking_type === 'time') {
    const seconds = exercise.duration_seconds ?? 0;
    return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
  }
  return `${exercise.reps} reps`;
}

/**
 * Checklist of a plan day's exercises. Tapping the box marks every series at
 * once; the numbered pills below set a partial count in one tap, which is how a
 * guided session that stopped halfway shows up.
 *
 * `lockedFor` is the number of series already stored on the server — those
 * cannot be unticked here, since finishing only ever adds series.
 */
export function WorkoutChecklist({ exercises, state, onChange, lockedFor }: {
  exercises: TrainingPlanExercise[];
  state: ChecklistState;
  onChange: (exerciseId: number, entry: ChecklistEntry) => void;
  lockedFor?: (exerciseId: number) => number;
}) {
  return (
    <div className="space-y-3">
      {exercises.map((exercise) => {
        if (!exercise.id) return null;
        const id = exercise.id;
        const entry = state[id] ?? { setsDone: 0, weight: '' };
        const locked = lockedFor?.(id) ?? 0;
        const isComplete = entry.setsDone >= exercise.sets;
        const isPartial = entry.setsDone > 0 && !isComplete;

        const setSetsDone = (value: number) => onChange(id, { ...entry, setsDone: Math.max(locked, value) });

        return (
          <Card
            key={id}
            className={`transition-colors ${
              isComplete ? 'border-emerald-800 bg-emerald-950/20' : isPartial ? 'border-amber-900 bg-amber-950/10' : ''
            }`}
          >
            <div className="flex items-start gap-3">
              <button
                type="button"
                aria-label={isComplete ? `Desmarcar ${exercise.exercise_name}` : `Marcar ${exercise.exercise_name}`}
                aria-pressed={isComplete}
                onClick={() => setSetsDone(isComplete ? 0 : exercise.sets)}
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-all active:scale-90 ${
                  isComplete
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : isPartial
                      ? 'border-amber-500 bg-amber-500/20 text-amber-400'
                      : 'border-zinc-600 bg-transparent text-transparent'
                }`}
              >
                {isPartial ? <span className="h-1 w-3 rounded-full bg-amber-400" /> : (
                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                    <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <p className={`font-semibold leading-tight ${isComplete ? 'text-emerald-100' : 'text-white'}`}>
                  {exercise.exercise_name}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-lg bg-zinc-950 px-2 py-0.5 text-primary-300">
                    {exercise.sets} × {formatTarget(exercise)}
                  </span>
                  {exercise.rest_seconds > 0 && (
                    <span className="rounded-lg bg-zinc-950 px-2 py-0.5 text-zinc-500">{exercise.rest_seconds}s descanso</span>
                  )}
                  {entry.setsDone > 0 && (
                    <span className="rounded-lg bg-zinc-950 px-2 py-0.5 text-emerald-400">
                      {entry.setsDone} de {exercise.sets} feitas
                    </span>
                  )}
                </div>

                {exercise.sets > 1 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {Array.from({ length: exercise.sets }, (_, index) => index + 1).map((number) => {
                      const filled = entry.setsDone >= number;
                      const isLocked = number <= locked;
                      return (
                        <button
                          key={number}
                          type="button"
                          aria-label={`${number} série${number === 1 ? '' : 's'} concluída${number === 1 ? '' : 's'}`}
                          onClick={() => setSetsDone(entry.setsDone === number ? number - 1 : number)}
                          className={`h-7 w-7 rounded-lg text-xs font-bold transition-colors ${
                            filled
                              ? isLocked
                                ? 'bg-emerald-800 text-emerald-200'
                                : 'bg-emerald-600 text-white'
                              : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          {number}
                        </button>
                      );
                    })}
                  </div>
                )}

                {exercise.notes && <p className="mt-2 text-xs leading-relaxed text-zinc-500">{exercise.notes}</p>}

                {exercise.tracking_type !== 'time' && entry.setsDone > 0 && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      placeholder={exercise.last_weight_kg ? String(exercise.last_weight_kg) : '0'}
                      value={entry.weight}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => onChange(id, { ...entry, weight: event.target.value })}
                      className="w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-center text-sm font-bold text-white placeholder-zinc-600 focus:border-primary-500 focus:outline-none"
                    />
                    <span className="text-xs text-zinc-500">kg</span>
                    {exercise.last_weight_kg ? (
                      <span className="text-xs text-zinc-600">última vez: {exercise.last_weight_kg} kg</span>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
