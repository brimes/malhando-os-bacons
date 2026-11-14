import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  title: string;
  showBack?: boolean;
  rightAction?: React.ReactNode;
}

// Sem borda nem desfoque (o desfoque é só de modal). Título em display condensado.
export function Header({ title, showBack, rightAction }: HeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 bg-bg pt-safe">
      <div className="flex items-center justify-between min-h-[64px] px-5">
        <div className="flex min-w-0 items-center gap-3">
          {showBack && (
            <button
              onClick={() => navigate(-1)}
              aria-label="Voltar"
              className="press -ml-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 6l-6 6 6 6" />
              </svg>
            </button>
          )}
          <h1
            title={title}
            aria-label={title}
            className={`num line-clamp-2 min-w-0 text-fg break-anywhere [hyphens:none] [word-break:normal] ${
              title.length > 32
                ? 'text-[22px] leading-[1.1]'
                : title.length > 18
                  ? 'text-[24px] leading-[1.05] min-[360px]:text-[28px]'
                  : 'text-[28px] leading-[1.02] min-[360px]:text-[34px]'
            }`}
          >{title}</h1>
        </div>
        {rightAction && <div className="shrink-0">{rightAction}</div>}
      </div>
    </header>
  );
}
