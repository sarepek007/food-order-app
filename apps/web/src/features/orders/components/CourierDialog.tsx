import type { Courier, OrderDetails } from '@food/contracts';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useCouriersQuery } from '@/api/queries';
import { errorMessage } from '@/api/errors';

interface CourierDialogProps {
  open: boolean;
  order: OrderDetails;
  busy: boolean;
  onClose: () => void;
  onSelect: (courierId: string) => void;
}

function availability(courier: Courier, isCurrent: boolean): { disabled: boolean; hint: string } {
  if (isCurrent) return { disabled: true, hint: 'уже назначен на этот заказ' };
  if (!courier.isActive) return { disabled: true, hint: 'неактивен' };
  if (!courier.hasCapacity) {
    return { disabled: true, hint: `нет свободных слотов (${courier.activeOrdersCount}/${courier.activeLimit})` };
  }
  return { disabled: false, hint: `${courier.activeOrdersCount}/${courier.activeLimit} активных` };
}

/**
 * Загрузка курьера видна до нажатия: оператор не должен узнавать о лимите
 * из ошибки. Сервер всё равно проверит — интерфейс лишь экономит попытку.
 */
export function CourierDialog({ open, order, busy, onClose, onSelect }: CourierDialogProps) {
  const couriers = useCouriersQuery();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      title={order.courier ? 'Сменить курьера' : 'Назначить курьера'}
      description={`Заказ №${order.publicNumber}. Один курьер ведёт не более трёх активных доставок.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!selected}
            loading={busy}
            onClick={() => selected && onSelect(selected)}
          >
            Назначить
          </Button>
        </>
      }
    >
      {couriers.isLoading && <p className="text-sm text-muted">Загружаем курьеров…</p>}

      {couriers.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(couriers.error)}
        </p>
      )}

      {couriers.data && (
        <ul className="-mx-1 max-h-72 overflow-y-auto">
          {couriers.data.map((courier) => {
            const isCurrent = order.courier?.id === courier.id;
            const { disabled, hint } = availability(courier, isCurrent);

            return (
              <li key={courier.id}>
                <label
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                    disabled ? 'opacity-50' : 'cursor-pointer hover:bg-accent-soft'
                  }`}
                >
                  <input
                    type="radio"
                    name="courier"
                    value={courier.id}
                    disabled={disabled}
                    checked={selected === courier.id}
                    onChange={() => setSelected(courier.id)}
                  />
                  <span className="flex-1 text-sm font-medium text-ink">{courier.name}</span>
                  <span className="tabular text-xs text-muted">{hint}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
