import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../lib/useCountUp';

export interface TrendPoint { date: string; value: number }

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
const fmtNum = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/**
 * Linha de evolução em SVG puro. Trilho em surface-2, linha e ponto final na
 * cor da área (violet), meta tracejada. A linha desenha em 700 ms por
 * stroke-dashoffset (pathLength normalizado); com reduzir movimento aparece
 * pronta. `compact` tira rótulos e eixos para uso em cartão pequeno.
 */
export function TrendChart({ points, target, unit, compact = false, height }: {
  points: TrendPoint[];
  target?: number;
  unit: string;
  compact?: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  const reduced = prefersReducedMotion();
  const [drawn, setDrawn] = useState(reduced);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || 300);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 300));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (reduced) return;
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [reduced]);

  const h = height ?? (compact ? 44 : 168);
  const padX = compact ? 10 : 16;
  const padTop = compact ? 6 : 22;
  const padBottom = compact ? 6 : 26;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values, target ?? Infinity);
  const hi = Math.max(...values, target ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => padX + (points.length === 1 ? (width - 2 * padX) / 2 : (i / (points.length - 1)) * (width - 2 * padX));
  const y = (v: number) => padTop + (1 - (v - lo) / span) * (h - padTop - padBottom);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h - padBottom} L${x(0).toFixed(1)},${h - padBottom} Z`;
  const last = points[points.length - 1];
  const gradId = `tg-${compact ? 'c' : 'l'}-${Math.abs(Math.round(values.reduce((a, b) => a + b, 0) * 10))}-${points.length}`;
  const rails = compact ? [] : [0, 0.5, 1].map((t) => padTop + t * (h - padTop - padBottom));
  const lx = x(points.length - 1);
  // O rótulo do ponto final vai para o lado em que cabe.
  const labelAnchor = lx > width - 52 ? 'end' : 'middle';

  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img"
        aria-label={`Evolução, de ${fmtNum(points[0].value)} para ${fmtNum(last.value)} ${unit}`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--violet))" stopOpacity={0.28} />
            <stop offset="100%" stopColor="rgb(var(--violet))" stopOpacity={0} />
          </linearGradient>
        </defs>
        {rails.map((ry, i) => (
          <line key={i} x1={0} x2={width} y1={ry} y2={ry} stroke="rgb(var(--surface-2))" strokeWidth={2} />
        ))}
        {target != null && !compact && (
          <>
            <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke="rgb(var(--violet))" strokeOpacity={0.55}
              strokeWidth={1.5} strokeDasharray="5 5" />
            <text x={width - 2} y={y(target) - 6} textAnchor="end" fontSize={12} fontWeight={600} fill="rgb(var(--muted))">
              meta {fmtNum(target)} {unit}
            </text>
          </>
        )}
        {points.length > 1 && <path d={area} fill={`url(#${gradId})`} style={{ opacity: drawn ? 1 : 0, transition: 'opacity 700ms var(--ease)' }} />}
        {points.length > 1 && (
          <path d={line} fill="none" stroke="rgb(var(--violet))" strokeWidth={compact ? 2.5 : 3.5}
            strokeLinecap="round" strokeLinejoin="round" pathLength={1}
            strokeDasharray={1} strokeDashoffset={drawn ? 0 : 1}
            style={{ transition: reduced ? 'none' : 'stroke-dashoffset 700ms var(--ease)' }} />
        )}
        <g style={{ opacity: drawn ? 1 : 0, transition: 'opacity 260ms var(--ease) 600ms' }}>
          <circle cx={lx} cy={y(last.value)} r={compact ? 7 : 12} fill="rgb(var(--violet))" fillOpacity={0.2} />
          <circle cx={lx} cy={y(last.value)} r={compact ? 3.5 : 6} fill="rgb(var(--violet))" />
          {!compact && (
            <text x={lx} y={y(last.value) - 18 < 12 ? y(last.value) + 28 : y(last.value) - 18} textAnchor={labelAnchor}
              fontSize={13} fontWeight={700} fill="rgb(var(--fg))">
              {fmtNum(last.value)}
            </text>
          )}
        </g>
        {!compact && points.length > 1 && (
          <>
            <text x={padX} y={h - 6} textAnchor="start" fontSize={12} fontWeight={600} fill="rgb(var(--muted))">{fmtDate(points[0].date)}</text>
            <text x={width - padX} y={h - 6} textAnchor="end" fontSize={12} fontWeight={600} fill="rgb(var(--muted))">{fmtDate(last.date)}</text>
          </>
        )}
      </svg>
    </div>
  );
}
