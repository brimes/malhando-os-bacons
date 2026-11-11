import { Card } from '../Card';
import { CountUp } from '../CountUp';
import { Ring, Bar } from '../Ring';

interface Props {
  calories: number;
  caloriesTarget?: number;
  protein: number;
  proteinTarget?: number;
  carbs: number;
  carbsTarget?: number;
  fat: number;
  fatTarget?: number;
  eyebrow?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const frac = (v: number, t?: number) => (t && t > 0 ? v / t : 0);

// Protagonista da área: anel de kcal e macros. Proteína violet, carboidrato sun, gordura brand-fg.
export function KcalHero({ calories, caloriesTarget, protein, proteinTarget, carbs, carbsTarget, fat, fatTarget, eyebrow = 'Hoje', actionLabel, onAction }: Props) {
  const hasTarget = !!caloriesTarget && caloriesTarget > 0;
  const remaining = hasTarget ? Math.round(caloriesTarget! - calories) : 0;
  const over = hasTarget && remaining < 0;
  const macros = [
    { label: 'Proteína', v: protein, t: proteinTarget, bar: 'bg-violet', text: 'text-violet' },
    { label: 'Carboidrato', v: carbs, t: carbsTarget, bar: 'bg-sun', text: 'text-sun' },
    { label: 'Gordura', v: fat, t: fatTarget, bar: 'bg-brand-fg', text: 'text-brand-fg' },
  ];
  return (
    <Card tint="teal" className="!p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{eyebrow}</p>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="press -mr-2 min-h-[48px] px-2 text-[15px] font-semibold text-teal">{actionLabel}</button>
        )}
      </div>
      <div className="flex items-center gap-5">
        <Ring progress={frac(calories, caloriesTarget)} size={148} stroke={12} colorClass={over ? 'text-sun' : 'text-teal'} className="shrink-0">
          <div className="text-center">
            <p className="num text-[38px] leading-[1.05] text-fg"><CountUp value={Math.round(calories)} /></p>
            <p className="text-[13px] text-muted">kcal</p>
          </div>
        </Ring>
        <div className="min-w-0">
          {hasTarget ? (
            <>
              <p className="num text-[28px] leading-[1.05] text-teal">
                <CountUp value={Math.abs(remaining)} />
              </p>
              <p className="mt-1 text-[15px] leading-[1.45] text-muted">{over ? 'kcal acima da meta' : 'kcal para a meta'}</p>
              <p className="mt-1 text-[13px] text-dim">Meta de {Math.round(caloriesTarget!)} kcal</p>
            </>
          ) : (
            <p className="text-[15px] leading-[1.45] text-muted">Sem meta definida. Crie um plano para ver quanto falta.</p>
          )}
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-4">
        {macros.map((m) => (
          <div key={m.label} className="min-w-0">
            <p className="truncate text-[13px] text-muted">{m.label}</p>
            <p className={`num mt-0.5 text-[24px] leading-[1.1] ${m.text}`}>
              <CountUp value={Math.round(m.v)} /><span className="font-sans text-[13px] font-medium text-muted"> g</span>
            </p>
            <Bar progress={frac(m.v, m.t)} colorClass={m.bar} className="mt-2" />
            {m.t ? <p className="mt-1 text-[13px] text-dim">de {Math.round(m.t)} g</p> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
