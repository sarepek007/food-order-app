import {
  allowedTransitions,
  isCancellable,
  slaLimitFor,
  slaStateFor,
  type AuditEntry,
  type Courier,
  type OrderDetails,
  type OrderListItem,
  type OrderListResponse,
  type OrderStatus,
  type Restaurant,
} from '@food/contracts';

export const RESTAURANT: Restaurant = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Пушкин',
  address: 'Тверской бульвар, 26а',
  isActive: true,
};

export const COURIER_FREE: Courier = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Иван Соколов',
  phone: '+7 (900) 000-00-01',
  isActive: true,
  activeOrdersCount: 1,
  activeLimit: 3,
  hasCapacity: true,
};

export const COURIER_FULL: Courier = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Мария Петрова',
  phone: null,
  isActive: true,
  activeOrdersCount: 3,
  activeLimit: 3,
  hasCapacity: false,
};

let sequence = 0;

export function makeOrder(overrides: Partial<OrderDetails> = {}): OrderDetails {
  sequence += 1;
  const status: OrderStatus = overrides.status ?? 'new';

  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    publicNumber: 1000 + sequence,
    status,
    customerName: 'Пётр Клиентов',
    customerPhone: '+7 (900) 111-22-33',
    restaurant: { id: RESTAURANT.id, name: RESTAURANT.name, address: RESTAURANT.address },
    courier: null,
    deliveryAddress: 'Ленинский проспект, д. 12, кв. 45',
    totalAmount: '1290.50',
    currency: 'RUB',
    cancelReason: null,
    createdAt: '2026-05-20T09:00:00.000Z',
    updatedAt: '2026-05-20T09:30:00.000Z',
    statusChangedAt: '2026-05-20T09:30:00.000Z',
    secondsInStatus: 120,
    // Согласованное значение по умолчанию: тесты, которым важен именно
    // норматив, переопределяют его явно.
    slaState: slaStateFor({ status, secondsInStatus: 120 }),
    slaLimitSeconds: slaLimitFor(status),
    version: 1,
    allowedTransitions: [...allowedTransitions(status)],
    cancellable: isCancellable(status),
    ...overrides,
  };
}

export function toListItem(order: OrderDetails): OrderListItem {
  const { customerPhone: _phone, cancelReason: _reason, allowedTransitions: _t, cancellable: _c, ...rest } = order;
  return { ...rest, restaurant: { id: order.restaurant.id, name: order.restaurant.name } };
}

export function makeList(orders: OrderDetails[], overrides: Partial<OrderListResponse> = {}): OrderListResponse {
  return {
    items: orders.map(toListItem),
    page: 1,
    pageSize: 25,
    total: orders.length,
    totalPages: Math.max(Math.ceil(orders.length / 25), orders.length === 0 ? 0 : 1),
    ...overrides,
  };
}

export function makeAudit(entries: Partial<AuditEntry>[]): AuditEntry[] {
  return entries.map((entry, index) => ({
    id: String(index + 1),
    orderId: 'order',
    action: 'STATUS_CHANGED',
    oldStatus: 'new',
    newStatus: 'accepted',
    oldCourier: null,
    newCourier: null,
    comment: null,
    actor: 'Анна Петрова',
    createdAt: '2026-05-20T09:10:00.000Z',
    ...entry,
  }));
}

/** Тело ошибки в формате problem+json — как его отдаёт настоящий сервер. */
export function problem(
  code: string,
  status: number,
  detail: string,
  details?: unknown,
): Record<string, unknown> {
  return {
    type: `https://food-order-app.local/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: detail,
    status,
    detail,
    code,
    ...(details === undefined ? {} : { details }),
  };
}
