import type { AuditAction, AuditQuery, OrderStatus } from '@food/contracts';
import { and, asc, count, desc, eq, gt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client.js';
import { couriers, orderAuditLog } from '../db/schema.js';

export interface AuditEntryInput {
  orderId: string;
  action: AuditAction;
  actor: string;
  orderVersion: number;
  oldStatus?: OrderStatus | null;
  newStatus?: OrderStatus | null;
  oldCourierId?: string | null;
  newCourierId?: string | null;
  comment?: string | null;
}

export interface AuditRecord {
  id: string;
  orderId: string;
  action: AuditAction;
  oldStatus: OrderStatus | null;
  newStatus: OrderStatus | null;
  oldCourier: { id: string; name: string } | null;
  newCourier: { id: string; name: string } | null;
  comment: string | null;
  actor: string;
  orderVersion: number | null;
  createdAt: Date;
}

const oldCourier = alias(couriers, 'old_courier');
const newCourier = alias(couriers, 'new_courier');

const auditSelection = {
  id: orderAuditLog.id,
  orderId: orderAuditLog.orderId,
  action: orderAuditLog.action,
  oldStatus: orderAuditLog.oldStatus,
  newStatus: orderAuditLog.newStatus,
  comment: orderAuditLog.comment,
  actor: orderAuditLog.actor,
  orderVersion: orderAuditLog.orderVersion,
  createdAt: orderAuditLog.createdAt,
  oldCourierId: oldCourier.id,
  oldCourierName: oldCourier.name,
  newCourierId: newCourier.id,
  newCourierName: newCourier.name,
} as const;

/** Строка выборки журнала: описана явно, потому что LEFT JOIN добавляет null-ы. */
interface AuditSelectRow {
  id: bigint;
  orderId: string;
  action: AuditAction;
  oldStatus: OrderStatus | null;
  newStatus: OrderStatus | null;
  comment: string | null;
  actor: string;
  orderVersion: number | null;
  createdAt: Date;
  oldCourierId: string | null;
  oldCourierName: string | null;
  newCourierId: string | null;
  newCourierName: string | null;
}

function toAuditRecord(row: AuditSelectRow): AuditRecord {
  return {
    id: String(row.id),
    orderId: row.orderId,
    action: row.action,
    oldStatus: row.oldStatus,
    newStatus: row.newStatus,
    oldCourier: row.oldCourierId ? { id: row.oldCourierId, name: row.oldCourierName! } : null,
    newCourier: row.newCourierId ? { id: row.newCourierId, name: row.newCourierName! } : null,
    comment: row.comment,
    actor: row.actor,
    orderVersion: row.orderVersion,
    createdAt: row.createdAt,
  };
}

/** Журнал только пополняется: UPDATE и DELETE запрещены триггером в БД. */
export async function appendAudit(db: Database, entry: AuditEntryInput): Promise<void> {
  await db.insert(orderAuditLog).values({
    orderId: entry.orderId,
    action: entry.action,
    actor: entry.actor,
    orderVersion: entry.orderVersion,
    oldStatus: entry.oldStatus ?? null,
    newStatus: entry.newStatus ?? null,
    oldCourierId: entry.oldCourierId ?? null,
    newCourierId: entry.newCourierId ?? null,
    comment: entry.comment ?? null,
  });
}

function auditQueryBase(db: Database) {
  return db
    .select(auditSelection)
    .from(orderAuditLog)
    .leftJoin(oldCourier, eq(orderAuditLog.oldCourierId, oldCourier.id))
    .leftJoin(newCourier, eq(orderAuditLog.newCourierId, newCourier.id));
}

export interface AuditPage {
  items: AuditRecord[];
  total: number;
}

export async function listAuditForOrder(
  db: Database,
  orderId: string,
  query: AuditQuery,
): Promise<AuditPage> {
  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(orderAuditLog)
    .where(eq(orderAuditLog.orderId, orderId));

  if (total === 0) {
    return { items: [], total: 0 };
  }

  const direction = query.order === 'asc' ? asc : desc;
  const rows = await auditQueryBase(db)
    .where(eq(orderAuditLog.orderId, orderId))
    .orderBy(direction(orderAuditLog.createdAt), direction(orderAuditLog.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return { items: rows.map(toAuditRecord), total };
}

/**
 * События, произошедшие после указанной версии заказа.
 * По ним строится объяснение конфликта: «курьер: Иван → Мария».
 */
export async function listAuditSinceVersion(
  db: Database,
  orderId: string,
  version: number,
): Promise<AuditRecord[]> {
  const rows = await auditQueryBase(db)
    .where(and(eq(orderAuditLog.orderId, orderId), gt(orderAuditLog.orderVersion, version)))
    .orderBy(asc(orderAuditLog.orderVersion), asc(orderAuditLog.id));

  return rows.map(toAuditRecord);
}
