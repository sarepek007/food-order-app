import type { ReactNode } from 'react';
import { Button } from './Button';

/** Скелет строки таблицы: содержимое не «прыгает» после загрузки. */
export function TableSkeleton({ rows = 8, columns = 8 }: { rows?: number; columns?: number }) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex} className="border-t border-line">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex} className="px-3 py-3">
              <span className="block h-3 animate-pulse rounded bg-slate-200" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function CardSkeleton({ lines = 6 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="space-y-3 rounded-lg bg-surface p-5 ring-1 ring-line">
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="block h-3 animate-pulse rounded bg-slate-200"
          style={{ width: `${45 + ((index * 17) % 50)}%` }}
        />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  description: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export function ErrorState({ title, description, onRetry, retrying }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-base font-medium text-danger">{title}</p>
      <p className="max-w-md text-sm text-muted">{description}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} loading={retrying}>
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
    <div
      aria-hidden="true"
      className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-lg bg-accent-soft"
    >
      <span className="block h-full w-1/3 animate-[slide_1.1s_ease-in-out_infinite] bg-accent" />
      <style>{`@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
    </div>
  );
}
