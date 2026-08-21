import { ORDER_STATUS_LABELS, type OrderStatus } from '@food/contracts';

/** Цвета отражают смысл, а не порядок: серый — ожидание, синий — работа, зелёный — успех. */
const STYLES: Record<OrderStatus, string> = {
  new: 'bg-slate-100 text-slate-700 ring-slate-200',
  accepted: 'bg-accent-soft text-accent ring-blue-200',
  preparing: 'bg-warn-soft text-warn ring-amber-200',
  ready: 'bg-violet-50 text-violet-700 ring-violet-200',
  picked_up: 'bg-cyan-50 text-cyan-800 ring-cyan-200',
  delivered: 'bg-ok-soft text-ok ring-emerald-200',
  cancelled: 'bg-danger-soft text-danger ring-red-200',
};

interface StatusBadgeProps {
  status: OrderStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${STYLES[status]} ${className}`}
    >
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}
