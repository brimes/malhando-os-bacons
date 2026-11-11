import type { ReactNode } from 'react';
import { Button } from '../Button';

type Tone = 'brand' | 'violet' | 'teal' | 'ok';
const tone: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-fg',
  violet: 'bg-violet-soft text-violet',
  teal: 'bg-teal-soft text-teal',
  ok: 'bg-ok-soft text-ok',
};

/** Estado vazio desenhado: ícone grande, frase clara, uma ação. */
export function EmptyState({ icon, title, text, action, tint = 'brand', className = '' }: {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
  tint?: Tone;
  className?: string;
}) {
  return (
    <div className={`enter flex flex-col items-center px-4 py-12 text-center ${className}`}>
      <span className={`flex h-24 w-24 items-center justify-center rounded-xl [&>svg]:h-11 [&>svg]:w-11 ${tone[tint]}`}>{icon}</span>
      <h2 className="num mt-6 text-[26px] leading-[1.1] text-fg">{title}</h2>
      {text && <p className="mt-2 max-w-[300px] text-[15px] leading-[1.45] text-muted">{text}</p>}
      {action && (
        <Button size="lg" className="mt-6 min-w-[220px]" onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}

/** Erro com ação de tentar de novo. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="enter flex items-center gap-3 rounded-lg bg-danger-soft p-[18px]">
      <p className="min-w-0 flex-1 text-[15px] font-semibold leading-[1.4] text-danger">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="press min-h-[48px] shrink-0 rounded-md bg-surface px-4 text-[15px] font-bold text-danger">
          Tentar de novo
        </button>
      )}
    </div>
  );
}

/** Bloco de esqueleto: forma do conteúdo, sem animação em laço. */
export function Skel({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`fade-in-mob rounded-md bg-surface-2 ${className}`} />;
}

/** Linha de lista em esqueleto, no formato das linhas largas (72 px). */
export function SkelRows({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Carregando" className={`space-y-3 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex min-h-[72px] items-center gap-4 rounded-lg bg-surface p-[18px] shadow-card">
          <Skel className="h-12 w-12 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skel className="h-4 w-2/3" />
            <Skel className="h-3.5 w-1/3" />
          </div>
          <Skel className="h-7 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Título de seção (`heading`, 17 px) com ação opcional à direita. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-h-[32px] items-center justify-between gap-3">
      <h2 className="text-[17px] font-bold leading-[1.3] text-fg">{children}</h2>
      {right}
    </div>
  );
}

/** Rótulo de campo (13 px) acima de um input; o campo em si leva o estilo global. */
export function Field({ label, hint, children, className = '' }: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 flex items-baseline justify-between gap-2 text-[13px] font-semibold text-muted">
        {label}
        {hint && <span className="font-medium text-dim">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const stagger = (i: number) => ({ '--i': i } as React.CSSProperties);
