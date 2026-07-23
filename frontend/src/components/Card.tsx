interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className = '', onClick }: CardProps) {
  const baseClass = 'bg-zinc-900 border border-zinc-800 rounded-2xl p-4';
  const clickClass = onClick ? 'cursor-pointer hover:bg-zinc-800 active:scale-[0.99] transition-all' : '';

  return (
    <div className={`${baseClass} ${clickClass} ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
}

export function StatCard({ label, value, unit, color = 'text-white' }: StatCardProps) {
  return (
    <Card>
      <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>
        {value}
        {unit && <span className="text-sm font-normal text-zinc-400 ml-1">{unit}</span>}
      </p>
    </Card>
  );
}
