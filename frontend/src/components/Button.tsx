import { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'tonal' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg' | 'icon';
type Tone = 'brand' | 'teal' | 'violet' | 'sun' | 'ok';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Cor da área, só para `tonal` (fundo `*-soft`, texto da cor). */
  tone?: Tone;
  isLoading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

// Botão só de ícone (size="icon"): 48x48, exige aria-label.
type Props = ButtonProps &
  ({ size: 'icon'; 'aria-label': string } | { size?: Exclude<Size, 'icon'> });

// Cinco estados (MASTER): padrão, pressionado (.press: scale .97 em 120 ms),
// foco (:focus-visible global), ativo/selecionado (aria-pressed) e desabilitado
// (opacidade .45, sem escala).
const variantClasses: Record<Exclude<Variant, 'tonal'>, string> = {
  primary: 'bg-brand text-white',
  secondary: 'bg-surface-2 text-fg',
  danger: 'bg-surface-2 text-danger aria-pressed:bg-danger aria-pressed:text-white',
  ghost: 'text-muted',
};

const toneClasses: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-fg',
  teal: 'bg-teal-soft text-teal',
  violet: 'bg-violet-soft text-violet',
  sun: 'bg-sun-soft text-sun',
  ok: 'bg-ok-soft text-ok',
};

const sizeClasses: Record<Size, string> = {
  sm: 'min-h-[40px] px-4 text-[15px] rounded-sm',
  md: 'min-h-[48px] px-5 text-base rounded-md',
  lg: 'min-h-[58px] px-6 text-[17px] font-bold rounded-md',
  icon: 'h-12 w-12 shrink-0 rounded-md',
};

export function Button({
  variant = 'primary',
  size = 'md',
  tone = 'brand',
  isLoading,
  fullWidth,
  children,
  disabled,
  className = '',
  type = 'button',
  ...props
}: Props) {
  const color = variant === 'tonal' ? toneClasses[tone] : variantClasses[variant];
  return (
    <button
      type={type}
      {...props}
      disabled={disabled || isLoading}
      className={`press inline-flex items-center justify-center gap-2 font-semibold
        disabled:opacity-[.45] disabled:cursor-not-allowed
        ${color} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {isLoading ? (
        <svg className="animate-spin -ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : null}
      {children}
    </button>
  );
}
