import type { ReactNode } from 'react';
import { Button } from './Button';
import { AlertIcon, InboxIcon, RefreshIcon, SearchIcon } from './icons';

/** Скелет строки таблицы: содержимое не «прыгает» после загрузки. */
export function TableSkeleton({ rows = 8, columns = 9 }: { rows?: number; columns?: number }) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex} className="border-t border-line">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex} className="px-3 py-3.5">
              <span
                className="block h-2.5 animate-pulse rounded-full bg-slate-200"
                style={{
                  width: `${55 + ((rowIndex * 13 + columnIndex * 29) % 40)}%`,
                  animationDelay: `${(rowIndex % 4) * 90}ms`,
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function CardSkeleton({ lines = 6 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="space-y-3">
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="block h-2.5 animate-pulse rounded-full bg-slate-200"
          style={{ width: `${45 + ((index * 17) % 50)}%`, animationDelay: `${index * 70}ms` }}
        />
      ))}
    </div>
  );
}

type Tone = 'neutral' | 'search' | 'danger';

const TONES: Record<Tone, { ring: string; icon: string }> = {
  neutral: { ring: 'bg-slate-100 text-muted', icon: '' },
  search: { ring: 'bg-accent-soft text-accent', icon: '' },
  danger: { ring: 'bg-danger-soft text-danger', icon: '' },
};

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: Tone;
}

export function EmptyState({ title, description, action, tone = 'neutral' }: EmptyStateProps) {
  const IconComponent = tone === 'search' ? SearchIcon : InboxIcon;

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className={`flex size-11 items-center justify-center rounded-full ${TONES[tone].ring}`}>
        <IconComponent className="size-5" />
      </span>
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  description: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
}

export function ErrorState({ title, description, onRetry, retrying, compact }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-3 text-center ${compact ? 'px-4 py-8' : 'px-6 py-16'}`}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertIcon className="size-5" />
      </span>
      <p className="text-base font-medium text-ink">{title}</p>
      <p className="max-w-md text-sm text-muted">{description}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} loading={retrying} icon={<RefreshIcon />}>
          Повторить
        </Button>
      )}
    </div>
  );
}

/** Ненавязчивый индикатор фонового обновления поверх уже показанных данных. */
export function RefetchingBar({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-accent-soft">
      <span
        className="block h-full w-1/3 bg-accent"
        style={{ animation: 'indeterminate 1.1s ease-in-out infinite' }}
      />
    </div>
  );
}
