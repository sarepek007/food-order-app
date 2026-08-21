import { AUDIT_ACTIONS, ORDER_STATUSES } from '@food/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
} from 'drizzle-orm/pg-core';

/**
 * Описание схемы для типобезопасных запросов. Источник правды — SQL-миграции
 * в apps/api/migrations: здесь только зеркало, которое проверяется
 * интеграционным тестом schema.test.ts.
 */

export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const auditActionEnum = pgEnum('audit_action', AUDIT_ACTIONS);

export const restaurants = pgTable('restaurants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const couriers = pgTable('couriers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  phone: text('phone'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicNumber: bigint('public_number', { mode: 'number' }).generatedAlwaysAsIdentity(),
    status: orderStatusEnum('status').notNull().default('new'),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone'),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    courierId: uuid('courier_id').references(() => couriers.id),
    deliveryAddress: text('delivery_address').notNull(),
    deliveryAddressNormalized: text('delivery_address_normalized').generatedAlwaysAs(
      sql`normalize_address(delivery_address)`,
    ),
    // numeric возвращается драйвером строкой — см. ADR 0002.
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('RUB'),
    cancelReason: text('cancel_reason'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_orders_status').on(table.status),
    index('idx_orders_restaurant').on(table.restaurantId),
    index('idx_orders_courier').on(table.courierId),
    index('idx_orders_created_at_id').on(table.createdAt.desc(), table.id.desc()),
    index('idx_orders_updated_at_id').on(table.updatedAt.desc(), table.id.desc()),
  ],
);

export const orderAuditLog = pgTable(
  'order_audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    action: auditActionEnum('action').notNull(),
    oldStatus: orderStatusEnum('old_status'),
    newStatus: orderStatusEnum('new_status'),
    oldCourierId: uuid('old_courier_id').references(() => couriers.id),
    newCourierId: uuid('new_courier_id').references(() => couriers.id),
    comment: text('comment'),
    actor: text('actor').notNull().default('system'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_audit_order_created').on(table.orderId, table.createdAt.desc(), table.id.desc())],
);

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;
export type RestaurantRow = typeof restaurants.$inferSelect;
export type CourierRow = typeof couriers.$inferSelect;
export type AuditRow = typeof orderAuditLog.$inferSelect;

export const dbSchema = { restaurants, couriers, orders, orderAuditLog };
