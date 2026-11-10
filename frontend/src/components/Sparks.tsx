import { useMemo } from 'react';

const COLORS = ['bg-ok', 'bg-brand-fg', 'bg-sun', 'bg-teal'];

// Faíscas ao concluir série: 500 ms, só transform/opacity. Montar para disparar;
// pai deve ser `relative`. Com reduzir movimento, o CSS esconde tudo.
export function Sparks({ count = 10 }: { count?: number }) {
  const sparks = useMemo(
    () => Array.from({ length: count }, (_, i) => {
      const a = (Math.PI * 2 * i) / count;
      const d = 34 + (i % 3) * 10;
      return { i, x: Math.round(Math.cos(a) * d), y: Math.round(Math.sin(a) * d), delay: (i % 4) * 25 };
    }),
    [count],
  );
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
      {sparks.map((s) => (
        <span
          key={s.i}
          className={`spark ${COLORS[s.i % COLORS.length]}`}
          style={{ '--x': `${s.x}px`, '--y': `${s.y}px`, '--d': s.delay } as React.CSSProperties}
        />
      ))}
    </span>
  );
}
