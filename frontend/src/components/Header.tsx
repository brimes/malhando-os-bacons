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
          <h1 className="num min-w-0 text-[34px] leading-[1.02] text-fg">{title}</h1>
        </div>
        {rightAction && <div className="shrink-0">{rightAction}</div>}
      </div>
    </header>
  );
}
