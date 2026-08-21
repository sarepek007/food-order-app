import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';
import { dbSchema, orders } from '../../src/db/schema.js';
import type { DbPool } from '../../src/db/pool.js';
import { createTestPool, insertOrder, insertRestaurant, truncateAll } from '../helpers/test-db.js';

/**
 * schema.ts — рукописное зеркало SQL-миграций. Этот тест ловит расхождение:
 * без него забытая колонка обнаружилась бы только в рантайме.
 */
const pool: DbPool = createTestPool('drizzle-schema-test');
const db = createDatabase(pool);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

async function columnsInDatabase(table: string): Promise<string[]> {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY column_name`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

describe('соответствие drizzle-схемы и SQL-миграций', () => {
  it.each(Object.values(dbSchema).map((table) => [getTableConfig(table).name, table] as const))(
    'таблица %s описана в drizzle теми же колонками, что и в БД',
    async (name, table) => {
      const declared = getTableConfig(table)
        .columns.map((column) => column.name)
        .sort();
      expect(declared).toEqual(await columnsInDatabase(name));
    },
  );

  it('все объявленные таблицы существуют в БД', async () => {
    for (const table of Object.values(dbSchema)) {
      const { rows } = await pool.query<{ exists: boolean }>(
        'SELECT to_regclass($1) IS NOT NULL AS exists',
        [getTableConfig(table).name],
      );
      expect(rows[0]?.exists, getTableConfig(table).name).toBe(true);
    }
  });
});

describe('чтение через drizzle', () => {
  it('маппит snake_case колонки в camelCase поля', async () => {
    const restaurant = await insertRestaurant(pool);
    const inserted = await insertOrder(pool, {
      restaurantId: restaurant.id,
      deliveryAddress: 'ул. Ленина, д. 5',
      totalAmount: '1290.50',
    });

    const [order] = await db.select().from(orders).where(eq(orders.id, inserted.id));

    expect(order).toMatchObject({
      id: inserted.id,
      status: 'new',
      restaurantId: restaurant.id,
      courierId: null,
      deliveryAddress: 'ул. Ленина, д. 5',
      deliveryAddressNormalized: 'ул ленина д 5',
      version: 1,
      currency: 'RUB',
    });
    expect(order?.createdAt).toBeInstanceOf(Date);
    expect(typeof order?.publicNumber).toBe('number');
  });

  it('возвращает денежную сумму строкой без потери копеек', async () => {
    const restaurant = await insertRestaurant(pool);
    const inserted = await insertOrder(pool, {
      restaurantId: restaurant.id,
      totalAmount: '99999999.99',
    });

    const [order] = await db.select().from(orders).where(eq(orders.id, inserted.id));

    expect(order?.totalAmount).toBe('99999999.99');
    expect(typeof order?.totalAmount).toBe('string');
  });
});
