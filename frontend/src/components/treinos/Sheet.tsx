import type { ReactNode } from 'react';

/** Modal de baixo: sobe com `sheet-in`; o desfoque atrás é o único permitido. */
export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="sheet-in max-h-[88vh] w-full overflow-y-auto rounded-t-xl bg-surface p-5 pb-safe shadow-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function SheetRow({ icon, children, onClick, tone = 'fg', disabled }: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  tone?: 'fg' | 'brand' | 'danger';
  disabled?: boolean;
}) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'brand' ? 'text-brand-fg' : 'text-fg';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`press flex min-h-[56px] w-full items-center gap-4 rounded-md px-2 text-left text-[16px] font-semibold disabled:opacity-[.45] ${color}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      {children}
    </button>
  );
}
