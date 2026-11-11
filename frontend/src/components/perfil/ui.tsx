import type { CSSProperties, ReactNode } from 'react';
import { Button } from '../Button';

// Peças de layout das telas de Resultados e Perfil. Ficam aqui, e não em
// components/, porque ainda não são de outras áreas.

/** Índice de entrada escalonada (40 ms por item, no máximo 6 pelo CSS). */
export const stagger = (i: number) => ({ '--i': i }) as CSSProperties;

type IconName =
  | 'user' | 'dumbbell' | 'pin' | 'bot' | 'gear' | 'chart' | 'moon' | 'video' | 'sync'
  | 'target' | 'heart' | 'logout' | 'trash' | 'compass' | 'id' | 'bolt' | 'flame' | 'plus';

const PATHS: Record<IconName, ReactNode> = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  dumbbell: <path d="M2 12h2M20 12h2M6 7v10M18 7v10M4 9v6M20 9v6M6 12h12" />,
  pin: <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  bot: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 14h.01M15 14h.01" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  chart: <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  video: <><rect x="3" y="6" width="13" height="12" rx="3" /><path d="M16 10l5-3v10l-5-3" /></>,
  sync: <path d="M20 11a8 8 0 0 0-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15M20 20v-5h-5" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  heart: <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" />,
  logout: <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  compass: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
  id: <><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.5-1.5 5.5-1.5 6 0M15 10h3M15 14h3" /></>,
  bolt: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  flame: <path d="M12 2c.5 3-1.2 4.6-2.6 6.2C8 9.8 7 11.2 7 13.3A5 5 0 0 0 12 18.5a5 5 0 0 0 5-5.2c0-1.6-.7-2.8-1.5-3.8-.2 1.2-.8 1.9-1.6 2.3.4-3-.2-6.4-1.9-9.8z" />,
  plus: <path d="M12 5v14M5 12h14" />,
};

export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export const Chevron = () => (
  <svg className="h-5 w-5 shrink-0 text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** Título de seção: 17 px, 750. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-1">
      <h2 className="text-[17px] font-bold leading-[1.3] text-fg">{children}</h2>
      {aside}
    </div>
  );
}

type Tone = 'brand' | 'teal' | 'violet' | 'sun' | 'ok' | 'neutral';
const iconTone: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-fg',
  teal: 'bg-teal-soft text-teal',
  violet: 'bg-violet-soft text-violet',
  sun: 'bg-sun-soft text-sun',
  ok: 'bg-ok-soft text-ok',
  neutral: 'bg-surface-2 text-muted',
};

interface RowProps {
  icon?: IconName;
  tone?: Tone;
  label: string;
  /** Valor atual, à direita. */
  value?: ReactNode;
  hint?: string;
  onClick?: () => void;
  danger?: boolean;
  /** Controle à direita (ex.: interruptor) no lugar do chevron. */
  trailing?: ReactNode;
  disabled?: boolean;
}

/** Linha larga: pelo menos 60 px, ícone, rótulo, valor à direita e chevron. */
export function Row({ icon, tone = 'neutral', label, value, hint, onClick, danger, trailing, disabled }: RowProps) {
  const body = (
    <>
      {icon && (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-sm ${danger ? 'bg-danger-soft text-danger' : iconTone[tone]}`}>
          <Icon name={icon} />
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className={`block text-base font-semibold leading-[1.3] ${danger ? 'text-danger' : 'text-fg'}`}>{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] leading-[1.35] text-muted">{hint}</span>}
      </span>
      {value != null && <span className="max-w-[45%] shrink-0 truncate text-[15px] text-muted">{value}</span>}
      {trailing ?? (onClick && !danger ? <Chevron /> : null)}
    </>
  );
  const cls = 'flex min-h-[60px] w-full items-center gap-3 px-[18px] py-2.5';
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`press ${cls} disabled:opacity-[.45]`}>
      {body}
    </button>
  );
}

/** Grupo de linhas em um cartão sem borda; separa por tom, não por traço. */
export function Group({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean) as ReactNode[];
  return (
    <div className={`overflow-hidden rounded-lg bg-surface shadow-card ${className}`} style={style}>
      {items.map((child, i) => (
        <div key={i} className={i > 0 ? 'relative before:absolute before:inset-x-[18px] before:top-0 before:h-px before:bg-surface-2' : ''}>
          {child}
        </div>
      ))}
    </div>
  );
}

/** Interruptor 56 px de altura de linha, estado no aria-checked. */
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="press flex min-h-[64px] w-full items-center justify-between gap-4 px-[18px] py-3 text-left">
      <span className="min-w-0">
        <span className="block text-base font-semibold leading-[1.3] text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] leading-[1.4] text-muted">{hint}</span>}
      </span>
      <span className={`relative h-8 w-[52px] shrink-0 rounded-chip transition-colors duration-[120ms] ${checked ? 'bg-brand' : 'bg-surface-2'}`}>
        <span className={`absolute left-0 top-1 h-6 w-6 rounded-chip bg-white shadow-card transition-transform duration-[120ms] ${checked ? 'translate-x-[24px]' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}

/** Esqueleto de carregamento: blocos de surface-2 pulsando só em opacidade. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} aria-hidden="true" />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg bg-surface p-[18px] shadow-card" role="alert">
      <p className="text-base font-semibold text-fg">Não deu para carregar</p>
      <p className="mt-1 text-[15px] leading-[1.45] text-muted">{message}</p>
      <Button variant="secondary" fullWidth className="mt-4" onClick={onRetry}>Tentar de novo</Button>
    </div>
  );
}

/** Aviso inline (erro ou nota) com texto na cor, fundo tingido. */
export function Notice({ tone, children }: { tone: 'danger' | 'sun' | 'violet' | 'brand' | 'ok'; children: ReactNode }) {
  const t = {
    danger: 'bg-danger-soft text-danger', sun: 'bg-sun-soft text-sun', violet: 'bg-violet-soft text-violet',
    brand: 'bg-brand-soft text-brand-fg', ok: 'bg-ok-soft text-ok',
  }[tone];
  return <div className={`rounded-md p-3.5 text-[15px] leading-[1.45] ${t}`} role={tone === 'danger' ? 'alert' : undefined}>{children}</div>;
}

/** Rótulo de campo: 13 px, tom muted. */
export const fieldLabel = 'block text-[13px] font-semibold leading-[1.3] text-muted';

/** Segmentado de opções, 48 px, selecionada em brand. */
export function Segmented<T extends string | number>({ options, value, onChange, label, cols }: {
  options: { value: T; label: string }[];
  value: T | null | '';
  onChange: (v: T) => void;
  label: string;
  cols?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-2 ${cols ?? ''}`} style={cols ? undefined : { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`press min-h-[48px] rounded-md px-2 text-[15px] font-semibold ${on ? 'bg-brand text-white' : 'bg-surface-2 text-muted'}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
