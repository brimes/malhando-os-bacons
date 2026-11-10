type Tint = 'brand' | 'teal' | 'violet' | 'sun' | 'ok';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  /** Leve tom da cor da área no topo do cartão. */
  tint?: Tint;
}

const tintClass: Record<Tint, string> = {
  brand: 'tint-brand',
  teal: 'tint-teal',
  violet: 'tint-violet',
  sun: 'tint-sun',
  ok: 'tint-ok',
};

// Sem borda: separa por tom e sombra (MASTER). Clicável vira botão para teclado/leitor de tela.
export function Card({ children, className = '', onClick, tint }: CardProps) {
  const base = `bg-surface rounded-lg shadow-card p-[18px] ${tint ? tintClass[tint] : ''}`;
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={`${base} press cursor-pointer ${className}`}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {children}
      </div>
    );
  }
  return <div className={`${base} ${className}`}>{children}</div>;
}

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
}

export function StatCard({ label, value, unit, color = 'text-fg' }: StatCardProps) {
  return (
    <Card>
      <p className="text-[13px] text-muted font-semibold uppercase tracking-[0.06em] mb-1">{label}</p>
      <p className={`num text-[28px] leading-[1.05] ${color}`}>
        {value}
        {unit && <span className="font-sans text-[15px] font-medium text-muted ml-1">{unit}</span>}
      </p>
    </Card>
  );
}
