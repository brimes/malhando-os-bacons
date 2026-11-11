import { Button } from '../Button';
import { AlertIcon } from './icons';

type Tone = 'teal' | 'sun' | 'violet' | 'brand';
const soft: Record<Tone, string> = { teal: 'bg-teal-soft text-teal', sun: 'bg-sun-soft text-sun', violet: 'bg-violet-soft text-violet', brand: 'bg-brand-soft text-brand-fg' };

// Estado vazio desenhado: ícone, frase clara, uma ação.
export function EmptyState({ icon, title, text, actionLabel, onAction, tone = 'teal', className = '' }: {
  icon: React.ReactNode;
  title: string;
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center px-4 py-6 text-center ${className}`}>
      <span className={`flex h-14 w-14 items-center justify-center rounded-lg ${soft[tone]}`}>{icon}</span>
      <p className="mt-3 text-[17px] font-bold leading-[1.3] text-fg">{title}</p>
      {text && <p className="mt-1 max-w-[280px] text-[15px] leading-[1.45] text-muted">{text}</p>}
      {actionLabel && onAction && (
        <Button className="mt-4" tone="teal" variant="tonal" onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-lg bg-surface px-4 py-8 text-center shadow-card">
      <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-danger/15 text-danger"><AlertIcon /></span>
      <p className="mt-3 text-[17px] font-bold text-fg">Não deu certo</p>
      <p className="mt-1 max-w-[280px] text-[15px] leading-[1.45] text-muted">{message}</p>
      <Button className="mt-4" variant="secondary" onClick={onRetry}>Tentar de novo</Button>
    </div>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} aria-hidden="true" />;
}

// Esqueleto no formato de um cartão de lista (título + linhas).
export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-lg bg-surface p-[18px] shadow-card" aria-busy="true">
      <SkeletonBlock className="h-5 w-32" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => <SkeletonBlock key={i} className="h-12 w-full" />)}
      </div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex min-h-[48px] items-center justify-between gap-3">
      <h2 className="text-[17px] font-bold leading-[1.3] text-fg">{children}</h2>
      {right}
    </div>
  );
}
