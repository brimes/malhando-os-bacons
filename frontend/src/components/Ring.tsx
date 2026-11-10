import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../lib/useCountUp';

interface RingProps {
  /** 0 a 1 */
  progress: number;
  size?: number;
  stroke?: number;
  /** Classe de cor do traço, ex.: `text-teal`. O trilho é `surface-2`. */
  colorClass?: string;
  /** Desenha de 0 até o valor em 700 ms ao montar. */
  animate?: boolean;
  children?: React.ReactNode;
  className?: string;
}

// Anel: trilho surface-2, preenchimento na cor da área, ponta arredondada.
// Anima só stroke-dashoffset.
export function Ring({ progress, size = 96, stroke = 8, colorClass = 'text-brand-fg', animate = true, children, className = '' }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const target = Math.max(0, Math.min(1, progress));
  const [p, setP] = useState(animate && !prefersReducedMotion() ? 0 : target);
  useEffect(() => {
    if (!animate || prefersReducedMotion()) { setP(target); return; }
    const id = requestAnimationFrame(() => setP(target));
    return () => cancelAnimationFrame(id);
  }, [target, animate]);
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--surface-2))" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p)}
          className={`ring-draw ${colorClass}`}
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}

interface BarProps {
  progress: number;
  /** Classe de fundo da cor da área, ex.: `bg-violet`. */
  colorClass?: string;
  className?: string;
}

// Barra: trilho surface-2; o preenchimento é desenhado por transform (scaleX), nunca por largura.
export function Bar({ progress, colorClass = 'bg-brand-fg', className = '' }: BarProps) {
  const target = Math.max(0, Math.min(1, progress));
  return (
    <div className={`h-2 overflow-hidden rounded-chip bg-surface-2 ${className}`} role="progressbar" aria-valuenow={Math.round(target * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full w-full origin-left transition-transform duration-ring ease-mob" style={{ transform: `scaleX(${target})` }}>
        <div className={`bar-draw h-full w-full rounded-chip ${colorClass}`} />
      </div>
    </div>
  );
}
