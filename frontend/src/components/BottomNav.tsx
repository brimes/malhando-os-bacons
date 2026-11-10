import { NavLink } from 'react-router-dom';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const HomeIcon = () => (
  <svg className="h-[26px] w-[26px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
  </svg>
);

const DumbellIcon = () => (
  <svg className="h-[26px] w-[26px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 12h2M20 12h2M6 7v10M18 7v10M4 9v6M20 9v6M6 12h12" />
  </svg>
);

const ForkIcon = () => (
  <svg className="h-[26px] w-[26px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 21V3c-2 1-3 4-3 8h3" />
  </svg>
);

const ChartIcon = () => (
  <svg className="h-[26px] w-[26px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />
  </svg>
);

const UserIcon = () => (
  <svg className="h-[26px] w-[26px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

const navItems: NavItem[] = [
  { to: '/', label: 'Início', icon: <HomeIcon /> },
  { to: '/workouts', label: 'Treinos', icon: <DumbellIcon /> },
  { to: '/nutrition', label: 'Nutrição', icon: <ForkIcon /> },
  { to: '/results', label: 'Resultados', icon: <ChartIcon /> },
  { to: '/profile', label: 'Perfil', icon: <UserIcon /> },
];

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-surface pb-safe" aria-label="Principal">
      <div className="flex items-stretch justify-around px-1.5 pt-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `press relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 pb-1.5 text-[12px] font-semibold leading-none ${
                isActive ? 'text-brand-fg' : 'text-dim'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute -top-2 h-[3px] w-7 rounded-b-[3px] bg-brand-fg" aria-hidden="true" />}
                {item.icon}
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
