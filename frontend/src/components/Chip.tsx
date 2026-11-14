type Tone = 'neutral' | 'brand' | 'teal' | 'violet' | 'sun' | 'ok';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  brand: 'bg-brand-soft text-brand-fg',
  teal: 'bg-teal-soft text-teal',
  violet: 'bg-violet-soft text-violet',
  sun: 'bg-sun-soft text-sun',
  ok: 'bg-ok-soft text-ok',
};

// Chip é informação, não botão: 32 px, raio chip, `label`, sem sombra.
export function Chip({ tone = 'neutral', icon, children, className = '' }: {
  tone?: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex h-8 max-w-full items-center gap-1.5 rounded-chip px-3 text-[13px] font-semibold leading-[1.3] ${tones[tone]} ${className}`}>
      {icon && <span className="inline-flex h-[15px] w-[15px] items-center justify-center [&>svg]:h-[15px] [&>svg]:w-[15px]">{icon}</span>}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
