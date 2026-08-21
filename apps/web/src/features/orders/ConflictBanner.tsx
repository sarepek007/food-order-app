import type { OrderDetails } from '@food/contracts';
import { Button } from '@/components/Button';
import { AlertIcon, CheckIcon, RefreshIcon } from '@/components/icons';

export interface ConflictInfo {
  expectedVersion: number;
  actualVersion: number;
  changedFields: string[];
  changes: string[];
  current: OrderDetails;
}

interface ConflictBannerProps {
  conflict: ConflictInfo;
  /** Что оператор пытался сделать — показываем, чтобы решение было осознанным. */
  attemptDescription: string | null;
  onDismiss: () => void;
  onForce: () => void;
  forcing: boolean;
}

/**
 * Конфликт версий объясняется по существу: не «кто-то изменил заказ»,
 * а перечень изменений из журнала. Решение остаётся за оператором.
 */
export function ConflictBanner({
  conflict,
  attemptDescription,
  onDismiss,
  onForce,
  forcing,
}: ConflictBannerProps) {
  return (
    <div
      role="alert"
      data-testid="conflict-banner"
      className="flex gap-3 rounded-xl bg-warn-soft p-4 ring-1 ring-amber-200"
    >
      <AlertIcon className="mt-0.5 size-5 shrink-0 text-warn" />

      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-warn">Заказ изменён другим пользователем</h2>

        <p className="mt-1 text-sm text-ink-soft">
          {`Пока вы работали с заказом, его изменили. Ваша версия — ${conflict.expectedVersion}, актуальная — ${conflict.actualVersion}.`}
        </p>

        {conflict.changes.length > 0 && (
          <ul className="mt-2 space-y-1">
            {conflict.changes.map((change) => (
              <li
                key={change}
                className="flex items-start gap-2 rounded-md bg-white/70 px-2.5 py-1.5 text-sm text-ink"
              >
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
                {change}
              </li>
            ))}
          </ul>
        )}

        {attemptDescription && (
          <p className="mt-2 text-sm text-muted">
            {`Ваше действие: ${attemptDescription} — не применено.`}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onDismiss} icon={<RefreshIcon />}>
            Посмотреть актуальный заказ
          </Button>
          <Button variant="primary" onClick={onForce} loading={forcing} icon={<CheckIcon />}>
            Применить моё изменение поверх
          </Button>
        </div>
      </div>
    </div>
  );
}
