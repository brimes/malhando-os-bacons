import { Dumbbell } from './icons';

/** Espera longa (o assistente leva minutos): ícone pulsando, frase que troca, aviso de duração. */
export function WaitOverlay({ title, message, hint }: { title: string; message: string; hint: string }) {
  return (
    <div role="status" className="fade-in-mob fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 px-6 backdrop-blur-sm">
      <div className="w-full max-w-sm text-center">
        <span className="pulse-count mx-auto flex h-28 w-28 items-center justify-center rounded-xl bg-brand-soft text-brand-fg [&>svg]:h-12 [&>svg]:w-12"><Dumbbell /></span>
        <h2 className="num mt-7 text-[32px] leading-[1.05] text-fg">{title}</h2>
        <p key={message} className="fade-in-mob mt-3 min-h-[44px] text-[17px] font-semibold leading-[1.3] text-brand-fg">{message}</p>
        <p className="mt-3 text-[15px] text-muted">{hint}</p>
      </div>
    </div>
  );
}
