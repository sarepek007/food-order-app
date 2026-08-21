import { occupiesCourierSlot } from '@food/contracts';
import { withTransaction, type DbClient, type DbPool } from '../db/pool.js';
import { buildSeedPlan, type SeedPlan, type SeedPlanOptions } from './plan.js';

export interface SeedOptions extends SeedPlanOptions {
  /** Полностью очистить таблицы перед загрузкой. */
  reset?: boolean;
}

export interface SeedSummary {
  restaurants: number;
  couriers: number;
  orders: number;
  auditEntries: number;
  statusBreakdown: Record<string, number>;
  unassignedOrders: number;
  maxCourierLoad: number;
  durationMs: number;
}

/** Postgres ограничивает число параметров запроса; вставляем пачками. */
const CHUNK_SIZE = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Собирает многострочный INSERT: ($1,$2), ($3,$4), ... */
async function insertRows(
  client: DbClient,
  table: string,
  columns: readonly string[],
  rows: readonly unknown[][],
): Promise<void> {
  for (const batch of chunk(rows, CHUNK_SIZE)) {
    const values = batch
      .map(
        (_row, rowIndex) =>
          `(${columns.map((_column, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(', ')})`,
      )
      .join(', ');

    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`,
      batch.flat(),
    );
  }
}

/**
 * Загружает воспроизводимый набор данных.
 *
 * Версии заказов и временные метки проставляются явно, поэтому на время
 * загрузки триггер версионирования выключается: иначе он перезапишет
 * updated_at значением now() и сломает согласованность с журналом.
 * ALTER TABLE транзакционен — при откате триггер остаётся включённым.
 */
export async function runSeed(pool: DbPool, options: SeedOptions = {}): Promise<SeedSummary> {
  const startedAt = Date.now();
  const plan = buildSeedPlan(options);

  await withTransaction(pool, async (client) => {
    if (options.reset !== false) {
      await client.query('TRUNCATE order_audit_log, orders, restaurants, couriers RESTART IDENTITY CASCADE');
    }

    await insertRows(
      client,
      'restaurants',
      ['id', 'name', 'address'],
      plan.restaurants.map((restaurant) => [restaurant.id, restaurant.name, restaurant.address]),
    );

    await insertRows(
      client,
      'couriers',
      ['id', 'name', 'phone', 'is_active'],
      plan.couriers.map((courier) => [courier.id, courier.name, courier.phone, courier.isActive]),
    );

    await client.query('ALTER TABLE orders DISABLE TRIGGER trg_orders_bump_version');
    try {
      await insertRows(
        client,
        'orders',
        [
          'id',
          'status',
          'customer_name',
          'customer_phone',
          'restaurant_id',
          'courier_id',
          'delivery_address',
          'total_amount',
          'cancel_reason',
          'version',
          'created_at',
          'updated_at',
        ],
        plan.orders.map((order) => [
          order.id,
          order.status,
          order.customerName,
          order.customerPhone,
          plan.restaurants[order.restaurantIndex]!.id,
          order.courierIndex === null ? null : plan.couriers[order.courierIndex]!.id,
          order.deliveryAddress,
          order.totalAmount,
          order.cancelReason,
          order.version,
          order.createdAt,
          order.updatedAt,
        ]),
      );
    } finally {
      await client.query('ALTER TABLE orders ENABLE TRIGGER trg_orders_bump_version');
    }

    const auditRows = plan.orders.flatMap((order) =>
      order.events.map((event) => [
        order.id,
        event.action,
        event.oldStatus,
        event.newStatus,
        event.oldCourierIndex === null ? null : plan.couriers[event.oldCourierIndex]!.id,
        event.newCourierIndex === null ? null : plan.couriers[event.newCourierIndex]!.id,
        event.comment,
        event.actor,
        event.orderVersion,
        event.at,
      ]),
    );

    await insertRows(
      client,
      'order_audit_log',
      [
        'order_id',
        'action',
        'old_status',
        'new_status',
        'old_courier_id',
        'new_courier_id',
        'comment',
        'actor',
        'order_version',
        'created_at',
      ],
      auditRows,
    );
  });

  return summarize(plan, Date.now() - startedAt);
}

function summarize(plan: SeedPlan, durationMs: number): SeedSummary {
  const statusBreakdown: Record<string, number> = {};
  const load = new Map<number, number>();

  for (const order of plan.orders) {
    statusBreakdown[order.status] = (statusBreakdown[order.status] ?? 0) + 1;
    if (order.courierIndex !== null && occupiesCourierSlot(order.status)) {
      load.set(order.courierIndex, (load.get(order.courierIndex) ?? 0) + 1);
    }
  }

  return {
    restaurants: plan.restaurants.length,
    couriers: plan.couriers.length,
    orders: plan.orders.length,
    auditEntries: plan.orders.reduce((sum, order) => sum + order.events.length, 0),
    statusBreakdown,
    unassignedOrders: plan.orders.filter((order) => order.courierIndex === null).length,
    maxCourierLoad: load.size === 0 ? 0 : Math.max(...load.values()),
    durationMs,
  };
}
