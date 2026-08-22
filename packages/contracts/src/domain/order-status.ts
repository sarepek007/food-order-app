/**
 * Жизненный цикл заказа — единственный источник правды для бекенда и фронтенда.
 *
 * new → accepted → preparing → ready → picked_up → delivered
 * Любой статус до picked_up может быть отменён (cancelled).
 */

export const ORDER_STATUSES = [
  'new',
  'accepted',
  'preparing',
  'ready',
  'picked_up',
  'delivered',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Граф переходов задан данными, а не цепочкой условий: так его можно
 * одновременно валидировать на сервере и рендерить кнопками на клиенте.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  Object.freeze({
    new: ['accepted', 'cancelled'],
    accepted: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['picked_up', 'cancelled'],
    picked_up: ['delivered'],
    delivered: [],
    cancelled: [],
  } as const);

/** Терминальные статусы: заказ больше не редактируется никаким способом. */
export const TERMINAL_STATUSES = ['delivered', 'cancelled'] as const satisfies readonly OrderStatus[];

/** Статусы, из которых заказ ещё можно отменить. После picked_up — нельзя. */
export const CANCELLABLE_STATUSES = [
  'new',
  'accepted',
  'preparing',
  'ready',
] as const satisfies readonly OrderStatus[];

/** Статусы, в которых заказ занимает слот курьера. */
export const COURIER_ACTIVE_STATUSES = ['ready', 'picked_up'] as const satisfies readonly OrderStatus[];

/**
 * Статусы, недостижимые без назначенного курьера: начиная с ready заказ
 * попадает в чью-то очередь доставки, поэтому исполнитель обязан быть известен.
 */
export const COURIER_REQUIRED_STATUSES = [
  'ready',
  'picked_up',
  'delivered',
] as const satisfies readonly OrderStatus[];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: OrderStatus): boolean {
  return (TERMINAL_STATUSES as readonly OrderStatus[]).includes(status);
}

export function isCancellable(status: OrderStatus): boolean {
  return (CANCELLABLE_STATUSES as readonly OrderStatus[]).includes(status);
}

export function occupiesCourierSlot(status: OrderStatus): boolean {
  return (COURIER_ACTIVE_STATUSES as readonly OrderStatus[]).includes(status);
}

export function requiresCourier(status: OrderStatus): boolean {
  return (COURIER_REQUIRED_STATUSES as readonly OrderStatus[]).includes(status);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Все допустимые переходы из статуса, включая отмену. */
export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

/**
 * Переходы «вперёд по конвейеру» без отмены — отмена в UI и API оформлена
 * отдельным действием, потому что требует указания причины.
 */
export function nextProgressStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ALLOWED_TRANSITIONS[from].filter((status) => status !== 'cancelled');
}

/** Человекочитаемые названия статусов для UI и текстов ошибок. */
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = Object.freeze({
  new: 'Новый',
  accepted: 'Принят',
  preparing: 'Готовится',
  ready: 'Готов к выдаче',
  picked_up: 'Забран курьером',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
});

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status];
}
