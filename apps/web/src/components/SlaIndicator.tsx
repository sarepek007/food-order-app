import { SLA_STATE_LABELS, formatDuration, type SlaState } from '@food/contracts';
import { ClockIcon } from './icons';

const STYLES: Record<SlaState, { text: string; icon: string }> = {
  none: { text: 'text-faint', icon: 'text-faint' },
  ok: { text: 'text-muted', icon: 'text-faint' },
  warning: { text: 'text-warn font-medium', icon: 'text-amber-500' },
  overdue: { text: 'text-danger font-semibold', icon: 'text-danger' },
};

interface SlaIndicatorProps {
  state: SlaState;
  secondsInStatus: number;
  limitSeconds: number | null;
  showIcon?: boolean;
}

/**
 * Сколько заказ находится в текущем статусе и укладывается ли в норматив.
 * Состояние передаётся цветом, начертанием и подписью — не только цветом.
 */
export function SlaIndicator({
  state,
  secondsInStatus,
  limitSeconds,
  showIcon = true,
}: SlaIndicatorProps) {
  const style = STYLES[state];

  const title =
    limitSeconds === null
      ? 'Статус терминальный — норматива нет'
      : `${SLA_STATE_LABELS[state]}: норматив ${formatDuration(limitSeconds)}`;

  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${style.text}`} title={title}>
      {showIcon && <ClockIcon className={`size-3.5 ${style.icon}`} />}
      {formatDuration(secondsInStatus)}
      {state === 'overdue' && <span className="sr-only">{` — ${SLA_STATE_LABELS.overdue}`}</span>}
    </span>
  );
}
