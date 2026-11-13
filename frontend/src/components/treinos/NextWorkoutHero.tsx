import { CountUp } from '../CountUp';
import { stagger } from './states';

interface Stat { label: string; value: number }
interface HeroExercise { name: string; prescription: string; detail?: string }

/**
 * O único bloco em degradê da tela: o treino que a pessoa veio fazer.
 * Só o botão navega, para não aninhar controles.
 *
 * Compartilhado pelo Início e por Treinos. Os nomes que o assistente gera são
 * longos ("Treino C - Quadríceps, Panturrilhas, Core e Cardio"), então título e
 * foco têm teto de duas linhas: o cartão não pode empurrar "Sua semana" para
 * fora da primeira tela.
 */
export function NextWorkoutHero({ eyebrow, title, focus, stats, exercises, moreExercises = 0, buttonLabel, onStart, footnote, index = 1, busy }: {
  eyebrow: string;
  title: string;
  focus?: string;
  stats?: Stat[];
  exercises?: HeroExercise[];
  moreExercises?: number;
  buttonLabel: string;
  onStart: () => void;
  footnote?: string;
  index?: number;
  busy?: boolean;
}) {
  const shown = (stats ?? []).filter((s) => s.value > 0);
  return (
    <div className="enter bg-hero rounded-xl p-5 text-white shadow-card" style={stagger(index)}>
      <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-white/90">{eyebrow}</p>
      <h2 className="num mt-1 line-clamp-2 text-[22px] leading-[1.15]">{title}</h2>
      {focus && <p className="mt-1 line-clamp-2 text-[15px] leading-[1.4] text-white/90">{focus}</p>}
      {shown.length > 0 && (
        <div className="mt-3 flex gap-6">
          {shown.map((s) => (
            <div key={s.label}>
              <p className="num text-[28px] leading-none"><CountUp value={s.value} /></p>
              <p className="mt-0.5 text-[13px] text-white/90">{s.label}</p>
            </div>
          ))}
        </div>
      )}
      {exercises && exercises.length > 0 && (
        <ul className="mt-3 space-y-1">
          {exercises.map((ex) => (
            <li key={ex.name} className="flex items-baseline justify-between gap-3 text-[15px] leading-[1.35]">
              <span className="min-w-0 truncate font-semibold">{ex.name}</span>
              <span className="shrink-0 text-[13px] text-white/90">
                <span className="num text-[16px] text-white">{ex.prescription}</span>
                {ex.detail ? ` · ${ex.detail}` : ''}
              </span>
            </li>
          ))}
          {moreExercises > 0 && <li className="text-[13px] text-white/90">e mais {moreExercises}</li>}
        </ul>
      )}
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="press mt-4 inline-flex min-h-[58px] w-full items-center justify-center gap-2 rounded-md bg-white px-6 text-[17px] font-bold text-brand disabled:opacity-[.45]"
      >
        {buttonLabel}
      </button>
      {footnote && <p className="mt-2 text-center text-[13px] text-white/90">{footnote}</p>}
    </div>
  );
}
