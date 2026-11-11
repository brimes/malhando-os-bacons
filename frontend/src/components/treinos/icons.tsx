// Ícones de traço da área Treinos. Herdam a cor do texto (currentColor).
type P = { className?: string };

const base = (className: string | undefined, fallback: string) => ({
  className: className ?? fallback,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
});

export const ChevronRight = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M9 6l6 6-6 6" /></svg>
);
export const ChevronLeft = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M15 6l-6 6 6 6" /></svg>
);
export const Plus = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M12 5v14M5 12h14" /></svg>
);
export const Check = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')} strokeWidth={3}><path d="M5 13l4 4L19 7" /></svg>
);
export const Dumbbell = ({ className }: P) => (
  <svg {...base(className, 'h-6 w-6')}><path d="M2 12h2M20 12h2M6 7v10M18 7v10M4 9v6M20 9v6M6 12h12" /></svg>
);
export const Calendar = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>
);
export const Clock = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const Repeat = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" /></svg>
);
export const Layers = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" /></svg>
);
export const Pin = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);
export const Archive = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" /></svg>
);
export const History = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.500M3.5 4v4.500H8M12 7.500V12l3 2" /></svg>
);
export const Spark = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M12 3l1.8 5.200L19 10l-5.2 1.800L12 17l-1.8-5.200L5 10l5.2-1.800L12 3zM19 16l.8 2.200L22 19l-2.2.8L19 22l-.8-2.200L16 19l2.2-.8L19 16z" /></svg>
);
export const MoreDots = ({ className }: P) => (
  <svg className={className ?? 'h-6 w-6'} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="18.5" r="2" /></svg>
);
export const Trash = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
);
export const Play = ({ className }: P) => (
  <svg className={className ?? 'h-5 w-5'} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
);
export const Wifi = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.500a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.500h.01" /></svg>
);
export const Pencil = ({ className }: P) => (
  <svg {...base(className, 'h-5 w-5')}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /></svg>
);
