import { CountUp } from '../CountUp';
import { stagger } from './states';

interface Stat { label: string; value: number }

/**
 * O único bloco em degradê da tela: o treino que a pessoa veio fazer.
 * Só o botão navega, para não aninhar controles.
 */
export function NextWorkoutHero({ eyebrow, title, focus, stats, buttonLabel, onStart, footnote, index = 1, busy }: {
  eyebrow: string;
  title: string;
  focus?: string;
  stats?: Stat[];
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
      <h2 className="num mt-1 break-words text-[40px] leading-[1.02]">{title}</h2>
      {focus && <p className="mt-1.5 line-clamp-2 text-[15px] leading-[1.4] text-white/90">{focus}</p>}
      {shown.length > 0 && (
        <div className="mt-5 flex gap-7">
          {shown.map((s) => (
            <div key={s.label}>
              <p className="num text-[38px] leading-none"><CountUp value={s.value} /></p>
              <p className="mt-1 text-[13px] text-white/90">{s.label}</p>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="press mt-5 inline-flex min-h-[58px] w-full items-center justify-center gap-2 rounded-md bg-white px-6 text-[17px] font-bold text-brand disabled:opacity-[.45]"
      >
        {buttonLabel}
      </button>
      {footnote && <p className="mt-3 text-center text-[13px] text-white/90">{footnote}</p>}
    </div>
  );
}
