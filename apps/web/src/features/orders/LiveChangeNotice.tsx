import { describeOrderChange, type OrderChangeEvent } from '@food/contracts';
import { Button } from '@/components/Button';
import { RefreshIcon } from '@/components/icons';

interface LiveChangeNoticeProps {
  event: OrderChangeEvent;
  onDismiss: () => void;
}

/**
 * Уведомление о чужом изменении, пришедшем в открытую карточку.
 *
 * Данные уже перечитаны — оператор видит актуальное состояние и не получит
 * конфликт версий на следующем действии. Сообщение объясняет, почему карточка
 * изменилась сама.
 */
export function LiveChangeNotice({ event, onDismiss }: LiveChangeNoticeProps) {
  return (
    <div
      role="status"
      data-testid="live-change-notice"
      className="flex items-center gap-3 rounded-xl bg-accent-soft p-3 text-sm ring-1 ring-blue-200"
    >
      <RefreshIcon className="size-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-ink">
        {/* Формулировка без глагола в прошедшем времени: имя оператора —
            произвольная строка, и согласование по роду невозможно. */}
        {`Заказ изменён (${event.actor}): ${describeOrderChange(event)}. Данные обновлены.`}
      </p>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Понятно
      </Button>
    </div>
  );
}
