import type { OrderDetails } from '@food/contracts';
import { Button } from '@/components/Button';

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
      className="rounded-lg bg-warn-soft p-4 ring-1 ring-amber-200"
    >
      <h2 className="text-sm font-semibold text-warn">Заказ изменён другим пользователем</h2>

      <p className="mt-1 text-sm text-ink">
        Пока вы работали с заказом, его изменили. Ваша версия — {conflict.expectedVersion},
        актуальная — {conflict.actualVersion}.
      </p>

      {conflict.changes.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-sm text-ink">
          {conflict.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      )}

      {attemptDescription && (
        <p className="mt-2 text-sm text-muted">Ваше действие: {attemptDescription} — не применено.</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onDismiss}>
          Посмотреть актуальный заказ
        </Button>
        <Button variant="primary" onClick={onForce} loading={forcing}>
          Применить моё изменение поверх
        </Button>
      </div>
    </div>
  );
}
