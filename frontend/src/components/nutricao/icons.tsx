// Ícones de linha da área de nutrição. 24 px, traço herdado de `currentColor`.
type P = { className?: string };
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24', 'aria-hidden': true } as const;

export const PlateIcon = ({ className = 'h-6 w-6' }: P) => (
  <svg {...base} className={className}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /></svg>
);
export const TagIcon = ({ className = 'h-6 w-6' }: P) => (
  <svg {...base} className={className}><path d="M3 12V4h8l10 10-8 8L3 12z" /><circle cx="7.5" cy="8.5" r="1" fill="currentColor" /></svg>
);
export const PlusIcon = ({ className = 'h-6 w-6' }: P) => (
  <svg {...base} strokeWidth={2.5} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const ChatIcon = ({ className = 'h-6 w-6' }: P) => (
  <svg {...base} className={className}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
);
export const ChevronIcon = ({ className = 'h-5 w-5 text-dim' }: P) => (
  <svg {...base} className={`shrink-0 ${className}`}><path d="M9 5l7 7-7 7" /></svg>
);
export const BulbIcon = ({ className = 'h-5 w-5' }: P) => (
  <svg {...base} className={className}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></svg>
);
export const TrashIcon = ({ className = 'h-5 w-5' }: P) => (
  <svg {...base} className={className}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
export const CalendarIcon = ({ className = 'h-6 w-6' }: P) => (
  <svg {...base} className={className}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);
export const FlameIcon = ({ className = 'h-6 w-6' }: P) => (
  <svg {...base} className={className}><path d="M12 2c.5 3-1.2 4.6-2.6 6.2C8 9.8 7 11.2 7 13.3A5 5 0 0 0 12 18.5a5 5 0 0 0 5-5.2c0-1.6-.7-2.8-1.5-3.8-.2 1.2-.8 1.9-1.6 2.3.4-3-.2-6.4-1.9-9.8z" /></svg>
);
export const LeafIcon = ({ className = 'h-6 w-6' }: P) => (
  <svg {...base} className={className}><path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19c2-5 5-8 9-10" /></svg>
);
export const AlertIcon = ({ className = 'h-6 w-6' }: P) => (
  <svg {...base} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>
);
export const CameraIcon = ({ className = 'h-6 w-6' }: P) => (
  <svg {...base} className={className}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const CopyIcon = ({ className = 'h-5 w-5' }: P) => (
  <svg {...base} className={className}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
);
