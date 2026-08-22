/** Типы событий, попадающих в журнал заказа. Журнал append-only. */
export const AUDIT_ACTIONS = [
  'ORDER_CREATED',
  'STATUS_CHANGED',
  'COURIER_ASSIGNED',
  'COURIER_CHANGED',
  'COURIER_UNASSIGNED',
  'ORDER_CANCELLED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Readonly<Record<AuditAction, string>> = Object.freeze({
  ORDER_CREATED: 'Заказ создан',
  STATUS_CHANGED: 'Статус изменён',
  COURIER_ASSIGNED: 'Курьер назначен',
  COURIER_CHANGED: 'Курьер заменён',
  COURIER_UNASSIGNED: 'Курьер снят',
  ORDER_CANCELLED: 'Заказ отменён',
});

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(value);
}
