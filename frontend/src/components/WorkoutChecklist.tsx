import { useState } from 'react';
import { Card } from './Card';
import { Chip } from './Chip';
import { ExerciseVideoPlayer } from './ExerciseVideoPlayer';
import { ExerciseIllustration } from './ExerciseIllustration';
import { temVideoLocal } from '../lib/videos/videoStore';
import { isNetworkOnline } from '../lib/offline';
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
 * O vídeo do movimento, atrás de um toque.
 *
 * Não fica aberto porque esta lista é compacta de propósito — a pessoa varre
 * dez exercícios de olho, e dez vídeos 720×720 tocando ao mesmo tempo
 * transformariam a varredura num rolamento infinito, além de gastar bateria
 * animando o que ninguém está olhando.
 *
 * O botão só aparece quando há vídeo para mostrar: com o arquivo no aparelho,
 * ou com rede para buscá-lo. Offline e sem o arquivo, oferecer o toque seria
 * prometer o que não se pode entregar.
 */
function BotaoVerMovimento({ exercise }: { exercise: TrainingPlanExercise }) {
  const [aberto, setAberto] = useState(false);
  if (!exercise.video) {
    return <ExerciseIllustration exercise={exercise} className="mt-2" />;
  }
  if (!temVideoLocal(exercise.video.catalog_name) && !isNetworkOnline()) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setAberto((atual) => !atual)}
        className="press min-h-[44px] rounded-sm text-[15px] font-semibold text-brand-fg"
      >
        {aberto ? 'Ocultar movimento' : 'Ver movimento'}
      </button>
      {aberto && <ExerciseVideoPlayer video={exercise.video} className="mt-2 aspect-square w-full object-cover" />}
    </div>
  );
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
          <Card key={id} tint={isComplete ? 'ok' : isPartial ? 'sun' : undefined}>
            <div className="flex items-start gap-3">
              <button
                type="button"
                aria-label={isComplete ? `Desmarcar ${exercise.exercise_name}` : `Marcar ${exercise.exercise_name}`}
                aria-pressed={isComplete}
                onClick={() => setSetsDone(isComplete ? 0 : exercise.sets)}
                className="press -ml-2 -mt-2 flex h-12 w-12 shrink-0 items-center justify-center"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-sm transition-colors duration-press ease-mob ${
                    isComplete
                      ? 'bg-ok text-bg'
                      : isPartial
                        ? 'bg-sun-soft text-sun'
                        : 'bg-surface-2 text-transparent'
                  }`}
                >
                  {isPartial ? <span className="h-1 w-3 rounded-chip bg-sun" /> : (
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                      <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </button>

              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold leading-snug text-fg">{exercise.exercise_name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Chip tone="brand">{exercise.sets} × {formatTarget(exercise)}</Chip>
                  {exercise.rest_seconds > 0 && <Chip>{exercise.rest_seconds}s descanso</Chip>}
                  {entry.setsDone > 0 && <Chip tone="ok">{entry.setsDone} de {exercise.sets} feitas</Chip>}
                </div>

                {exercise.sets > 1 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Array.from({ length: exercise.sets }, (_, index) => index + 1).map((number) => {
                      const filled = entry.setsDone >= number;
                      const isLocked = number <= locked;
                      return (
                        <button
                          key={number}
                          type="button"
                          aria-label={`${number} série${number === 1 ? '' : 's'} concluída${number === 1 ? '' : 's'}`}
                          onClick={() => setSetsDone(entry.setsDone === number ? number - 1 : number)}
                          className={`press num h-10 w-10 rounded-sm text-[18px] leading-none ${
                            filled
                              ? isLocked
                                ? 'bg-ok-soft text-ok'
                                : 'bg-ok text-bg'
                              : 'bg-surface-2 text-dim'
                          }`}
                        >
                          {number}
                        </button>
                      );
                    })}
                  </div>
                )}

                <BotaoVerMovimento exercise={exercise} />

                {exercise.notes && <p className="mt-2 text-[15px] leading-[1.45] text-muted">{exercise.notes}</p>}

                {exercise.tracking_type !== 'time' && entry.setsDone > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      aria-label={`Carga de ${exercise.exercise_name} em quilos`}
                      placeholder={exercise.last_weight_kg ? String(exercise.last_weight_kg) : '0'}
                      value={entry.weight}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => onChange(id, { ...entry, weight: event.target.value })}
                      className="w-24 text-center font-bold"
                    />
                    <span className="text-[15px] text-muted">kg</span>
                    {exercise.last_weight_kg ? (
                      <span className="text-[13px] text-dim">última vez: {exercise.last_weight_kg} kg</span>
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
