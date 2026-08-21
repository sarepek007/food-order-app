import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-xs hover:bg-accent-strong active:bg-accent-strong disabled:bg-blue-300 disabled:shadow-none',
  secondary:
    'bg-surface text-ink-soft ring-1 ring-line-strong hover:bg-surface-muted hover:text-ink disabled:text-faint disabled:ring-line',
  danger: 'bg-danger text-white shadow-xs hover:bg-red-800 disabled:bg-red-300 disabled:shadow-none',
  ghost: 'text-muted hover:bg-slate-100 hover:text-ink disabled:text-faint',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Декоративная иконка перед текстом; из доступного имени исключена. */
  icon?: ReactNode;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-100 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
