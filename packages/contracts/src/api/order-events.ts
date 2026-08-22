/**
 * Событие изменения заказа.
 *
 * Публикуется после фиксации транзакции и доставляется потоком SSE.
 * Полезная нагрузка намеренно минимальна: она сообщает **повод** перечитать
 * заказ, а не заменяет его чтение. Лимит NOTIFY в Postgres — 8000 байт,
 * и класть туда всю карточку было бы ошибкой.
 */
import { AUDIT_ACTION_LABELS, type AuditAction } from '../domain/audit.js';
import { ORDER_STATUS_LABELS, type OrderStatus } from '../domain/order-status.js';

export const ORDER_CHANGED_EVENT = 'order-changed';
export const STREAM_READY_EVENT = 'ready';

export interface OrderChangeEvent {
  orderId: string;
  action: AuditAction;
  oldStatus: OrderStatus | null;
  newStatus: OrderStatus | null;
  /** Версия заказа после изменения; null у записей, созданных до миграции 0002. */
  version: number | null;
  actor: string;
  at: string;
}

/** Краткое описание события для уведомления в интерфейсе. */
export function describeOrderChange(event: OrderChangeEvent): string {
  switch (event.action) {
    case 'STATUS_CHANGED':
      return event.oldStatus && event.newStatus
        ? `статус «${ORDER_STATUS_LABELS[event.oldStatus]}» → «${ORDER_STATUS_LABELS[event.newStatus]}»`
        : 'статус изменён';
    case 'ORDER_CANCELLED':
      return 'заказ отменён';
    case 'COURIER_ASSIGNED':
      return 'назначен курьер';
    case 'COURIER_CHANGED':
      return 'заменён курьер';
    case 'COURIER_UNASSIGNED':
      return 'снят курьер';
    case 'ORDER_CREATED':
      return 'заказ создан';
    default:
      return AUDIT_ACTION_LABELS[event.action] ?? 'заказ изменён';
  }
}

export function isOrderChangeEvent(value: unknown): value is OrderChangeEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['orderId'] === 'string' && typeof candidate['action'] === 'string';
}
