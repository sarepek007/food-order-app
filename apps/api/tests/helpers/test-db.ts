import process from 'node:process';
import { createPool, type DbPool } from '../../src/db/pool.js';

const DEFAULT_TEST_URL = 'postgres://food:food@localhost:5432/food_orders_test';

/** Тесты никогда не должны попасть в БД приложения — отсюда отдельная переменная. */
export function testDatabaseUrl(): string {
  return process.env['TEST_DATABASE_URL'] ?? DEFAULT_TEST_URL;
}

export function createTestPool(applicationName = 'food-order-tests'): DbPool {
  return createPool({
    connectionString: testDatabaseUrl(),
    max: 10,
    applicationName,
    // Тесты конкурентности намеренно держат блокировки: короткий statement_timeout
    // превратил бы ожидание лока в ложное падение.
    statementTimeoutMillis: 15_000,
  });
}

const TABLES = ['order_audit_log', 'orders', 'restaurants', 'couriers'] as const;

/**
 * TRUNCATE, а не DELETE: не срабатывают строковые триггеры, поэтому
 * append-only-защита журнала не мешает очистке между тестами.
 */
export async function truncateAll(pool: DbPool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export interface SeedRestaurant {
  id: string;
  name: string;
}

export interface SeedCourier {
  id: string;
  name: string;
}

export async function insertRestaurant(
  pool: DbPool,
  overrides: Partial<{ name: string; address: string; isActive: boolean }> = {},
): Promise<SeedRestaurant> {
  const { rows } = await pool.query<SeedRestaurant>(
    `INSERT INTO restaurants (name, address, is_active)
     VALUES ($1, $2, $3)
     RETURNING id, name`,
    [
      overrides.name ?? 'Тестовый ресторан',
      overrides.address ?? 'ул. Ресторанная, 1',
      overrides.isActive ?? true,
    ],
  );
  return rows[0]!;
}

export async function insertCourier(
  pool: DbPool,
  overrides: Partial<{ name: string; phone: string | null; isActive: boolean }> = {},
): Promise<SeedCourier> {
  const { rows } = await pool.query<SeedCourier>(
    `INSERT INTO couriers (name, phone, is_active)
     VALUES ($1, $2, $3)
     RETURNING id, name`,
    [overrides.name ?? 'Тестовый курьер', overrides.phone ?? null, overrides.isActive ?? true],
  );
  return rows[0]!;
}

export interface InsertOrderOptions {
  restaurantId: string;
  courierId?: string | null;
  status?: string;
  customerName?: string;
  deliveryAddress?: string;
  totalAmount?: string;
  cancelReason?: string | null;
  createdAt?: Date;
}

export async function insertOrder(
  pool: DbPool,
  options: InsertOrderOptions,
): Promise<{ id: string; version: number; status: string }> {
  const { rows } = await pool.query<{ id: string; version: number; status: string }>(
    `INSERT INTO orders (customer_name, restaurant_id, courier_id, delivery_address,
                         total_amount, status, cancel_reason, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::order_status, $7,
             COALESCE($8::timestamptz, now()), COALESCE($8::timestamptz, now()))
     RETURNING id, version, status::text AS status`,
    [
      options.customerName ?? 'Иван Клиентов',
      options.restaurantId,
      options.courierId ?? null,
      options.deliveryAddress ?? 'ул. Ленина, д. 5',
      options.totalAmount ?? '1000.00',
      options.status ?? 'new',
      options.cancelReason ?? null,
      options.createdAt ?? null,
    ],
  );
  return rows[0]!;
}
