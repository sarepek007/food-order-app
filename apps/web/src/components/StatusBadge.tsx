import { ORDER_STATUS_LABELS, type OrderStatus } from '@food/contracts';

/**
 * Цвет отражает смысл, а не порядок: серый — ожидание, синий — в работе,
 * фиолетовый и бирюзовый — доставка, зелёный — успех, красный — исключение.
 * Точка перед текстом даёт различимость без опоры на один только цвет.
 */
const STYLES: Record<OrderStatus, { badge: string; dot: string }> = {
  new: { badge: 'bg-slate-100 text-ink-soft ring-slate-200', dot: 'bg-slate-400' },
  accepted: { badge: 'bg-accent-soft text-accent-strong ring-blue-200', dot: 'bg-accent' },
  preparing: { badge: 'bg-warn-soft text-warn ring-amber-200', dot: 'bg-amber-500' },
  ready: { badge: 'bg-violet-50 text-violet-800 ring-violet-200', dot: 'bg-violet-500' },
  picked_up: { badge: 'bg-cyan-50 text-cyan-900 ring-cyan-200', dot: 'bg-cyan-500' },
  delivered: { badge: 'bg-ok-soft text-ok ring-emerald-200', dot: 'bg-emerald-500' },
  cancelled: { badge: 'bg-danger-soft text-danger ring-red-200', dot: 'bg-red-500' },
};

interface StatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusBadge({ status, size = 'sm', className = '' }: StatusBadgeProps) {
  const style = STYLES[status];
  const scale = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap ring-1 ring-inset ${style.badge} ${scale} ${className}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${style.dot}`} />
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}
