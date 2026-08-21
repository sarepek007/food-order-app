import {
  allowedTransitions,
  isCancellable,
  type AuditEntry,
  type Courier,
  type OrderDetails,
  type OrderListItem,
  type Paginated,
  type Restaurant,
} from '@food/contracts';
import type { CourierRow, RestaurantRow } from '../db/schema.js';
import type { AuditRecord } from '../repositories/audit-repository.js';
import type { OrderWithRefs } from '../repositories/order-repository.js';

/** ISO-8601 с часовым поясом — единственный формат времени в API. */
function iso(value: Date): string {
  return value.toISOString();
}

export function toOrderListItem({ order, restaurant, courier }: OrderWithRefs): OrderListItem {
  return {
    id: order.id,
    publicNumber: order.publicNumber,
    status: order.status,
    customerName: order.customerName,
    restaurant: { id: restaurant.id, name: restaurant.name },
    courier: courier ? { id: courier.id, name: courier.name } : null,
    deliveryAddress: order.deliveryAddress,
    totalAmount: order.totalAmount,
    currency: order.currency,
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
    version: order.version,
  };
}

export function toOrderDetails(source: OrderWithRefs): OrderDetails {
  const { order, restaurant } = source;
  return {
    ...toOrderListItem(source),
    customerPhone: order.customerPhone,
    cancelReason: order.cancelReason,
    restaurant: { id: restaurant.id, name: restaurant.name, address: restaurant.address },
    // Клиент рисует кнопки по этому списку и не воспроизводит граф переходов у себя.
    allowedTransitions: [...allowedTransitions(order.status)],
    cancellable: isCancellable(order.status),
  };
}

export function toAuditEntry(record: AuditRecord): AuditEntry {
  return {
    id: record.id,
    orderId: record.orderId,
    action: record.action,
    oldStatus: record.oldStatus,
    newStatus: record.newStatus,
    oldCourier: record.oldCourier,
    newCourier: record.newCourier,
    comment: record.comment,
    actor: record.actor,
    createdAt: iso(record.createdAt),
  };
}

export function toRestaurant(row: RestaurantRow): Restaurant {
  return { id: row.id, name: row.name, address: row.address, isActive: row.isActive };
}

export function toCourier(row: CourierRow & { activeOrdersCount: number }, limit: number): Courier {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    isActive: row.isActive,
    activeOrdersCount: row.activeOrdersCount,
    activeLimit: limit,
    hasCapacity: row.isActive && row.activeOrdersCount < limit,
  };
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}
