import { normalizeSearchQuery } from '@food/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DbPool } from '../../src/db/pool.js';
import {
  createTestPool,
  insertCourier,
  insertOrder,
  insertRestaurant,
  truncateAll,
} from '../helpers/test-db.js';

const pool: DbPool = createTestPool('schema-test');

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

async function errorOf(fn: () => Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await fn();
  } catch (error) {
    const pgError = error as Error & { code?: string; constraint?: string };
    return { message: pgError.constraint ?? pgError.message, code: pgError.code };
  }
  throw new Error('ожидалась ошибка БД, но операция прошла успешно');
}

describe('версия заказа и updated_at', () => {
  it('новый заказ создаётся с версией 1', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, { restaurantId: restaurant.id });
    expect(order.version).toBe(1);
  });

  it('реальное изменение инкрементирует версию и двигает updated_at', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, { restaurantId: restaurant.id });

    const { rows } = await pool.query<{ version: number; touched: boolean }>(
      `UPDATE orders SET status = 'accepted' WHERE id = $1
       RETURNING version, updated_at > created_at AS touched`,
      [order.id],
    );

    expect(rows[0]?.version).toBe(2);
    expect(rows[0]?.touched).toBe(true);
  });

  it('холостой UPDATE не двигает версию — иначе получаем ложные конфликты', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, { restaurantId: restaurant.id, status: 'accepted' });

    await pool.query(`UPDATE orders SET status = 'accepted' WHERE id = $1`, [order.id]);
    const { rows } = await pool.query<{ version: number }>(
      'SELECT version FROM orders WHERE id = $1',
      [order.id],
    );

    expect(rows[0]?.version).toBe(order.version);
  });

  it('игнорирует версию, присланную приложением: счётчик ведёт только БД', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, { restaurantId: restaurant.id });

    const { rows } = await pool.query<{ version: number }>(
      `UPDATE orders SET status = 'accepted', version = 100 WHERE id = $1 RETURNING version`,
      [order.id],
    );

    expect(rows[0]?.version).toBe(2);
  });

  it('условие WHERE version = ... отсекает устаревшее обновление', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, { restaurantId: restaurant.id });

    await pool.query(`UPDATE orders SET status = 'accepted' WHERE id = $1 AND version = $2`, [
      order.id,
      1,
    ]);
    const stale = await pool.query(
      `UPDATE orders SET status = 'preparing' WHERE id = $1 AND version = $2`,
      [order.id, 1],
    );

    expect(stale.rowCount).toBe(0);
  });
});

describe('момент смены статуса', () => {
  it('у нового заказа совпадает с датой создания', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, { restaurantId: restaurant.id });

    const { rows } = await pool.query<{ same: boolean }>(
      'SELECT status_changed_at = created_at AS same FROM orders WHERE id = $1',
      [order.id],
    );
    expect(rows[0]?.same).toBe(true);
  });

  it('обновляется при смене статуса', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, {
      restaurantId: restaurant.id,
      createdAt: new Date(Date.now() - 60_000),
    });

    const { rows } = await pool.query<{ moved: boolean }>(
      `UPDATE orders SET status = 'accepted' WHERE id = $1
       RETURNING status_changed_at > created_at AS moved`,
      [order.id],
    );
    expect(rows[0]?.moved).toBe(true);
  });

  it('НЕ обновляется при смене курьера — иначе норматив обнулялся бы зря', async () => {
    const restaurant = await insertRestaurant(pool);
    const courier = await insertCourier(pool);
    const order = await insertOrder(pool, {
      restaurantId: restaurant.id,
      createdAt: new Date(Date.now() - 60_000),
    });

    const { rows } = await pool.query<{ unchanged: boolean; version: number }>(
      `UPDATE orders SET courier_id = $2 WHERE id = $1
       RETURNING status_changed_at = created_at AS unchanged, version`,
      [order.id, courier.id],
    );

    // Версия выросла, потому что заказ изменился, а отметка статуса — нет.
    expect(rows[0]?.unchanged).toBe(true);
    expect(rows[0]?.version).toBe(2);
  });

  it('приложение не может подделать отметку', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, { restaurantId: restaurant.id });

    const { rows } = await pool.query<{ forged: boolean }>(
      `UPDATE orders SET status = 'accepted', status_changed_at = '2020-01-01T00:00:00Z'
       WHERE id = $1
       RETURNING status_changed_at < '2021-01-01T00:00:00Z' AS forged`,
      [order.id],
    );
    expect(rows[0]?.forged).toBe(false);
  });

  it('не может оказаться раньше создания заказа', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, { restaurantId: restaurant.id });

    const error = await errorOf(() =>
      pool.query(
        `UPDATE orders SET status_changed_at = created_at - interval '1 hour' WHERE id = $1`,
        [order.id],
      ),
    );
    expect(error.message).toBe('orders_status_changed_after_created');
  });
});

describe('ограничения целостности', () => {
  it('запрещает статус ready без курьера', async () => {
    const restaurant = await insertRestaurant(pool);
    const error = await errorOf(() =>
      insertOrder(pool, { restaurantId: restaurant.id, status: 'ready' }),
    );
    expect(error.message).toBe('orders_courier_required_from_ready');
  });

  it.each(['ready', 'picked_up', 'delivered'])('требует курьера в статусе %s', async (status) => {
    const restaurant = await insertRestaurant(pool);
    const courier = await insertCourier(pool);
    const order = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status,
    });

    const error = await errorOf(() =>
      pool.query('UPDATE orders SET courier_id = NULL WHERE id = $1', [order.id]),
    );
    expect(error.message).toBe('orders_courier_required_from_ready');
  });

  it('запрещает отмену без причины', async () => {
    const restaurant = await insertRestaurant(pool);
    const error = await errorOf(() =>
      insertOrder(pool, { restaurantId: restaurant.id, status: 'cancelled' }),
    );
    expect(error.message).toBe('orders_cancel_reason_required');
  });

  it('разрешает отмену с причиной', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, {
      restaurantId: restaurant.id,
      status: 'cancelled',
      cancelReason: 'клиент передумал',
    });
    expect(order.status).toBe('cancelled');
  });

  it('запрещает отрицательную сумму', async () => {
    const restaurant = await insertRestaurant(pool);
    const error = await errorOf(() =>
      insertOrder(pool, { restaurantId: restaurant.id, totalAmount: '-1.00' }),
    );
    expect(error.message).toContain('total_amount');
  });

  it('запрещает ссылку на несуществующий ресторан', async () => {
    const error = await errorOf(() =>
      insertOrder(pool, { restaurantId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(error.code).toBe('23503');
  });

  it('выдаёт возрастающие человекочитаемые номера заказов', async () => {
    const restaurant = await insertRestaurant(pool);
    await insertOrder(pool, { restaurantId: restaurant.id });
    await insertOrder(pool, { restaurantId: restaurant.id });

    const { rows } = await pool.query<{ public_number: string }>(
      'SELECT public_number FROM orders ORDER BY public_number',
    );
    expect(rows).toHaveLength(2);
    expect(Number(rows[1]!.public_number)).toBe(Number(rows[0]!.public_number) + 1);
  });
});

describe('журнал изменений append-only', () => {
  async function insertAuditRow(): Promise<string> {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, { restaurantId: restaurant.id });
    await pool.query(
      `INSERT INTO order_audit_log (order_id, action, new_status, actor)
       VALUES ($1, 'ORDER_CREATED', 'new', 'tester')`,
      [order.id],
    );
    return order.id;
  }

  it('разрешает добавление записей', async () => {
    const orderId = await insertAuditRow();
    const { rows } = await pool.query('SELECT * FROM order_audit_log WHERE order_id = $1', [orderId]);
    expect(rows).toHaveLength(1);
  });

  it('запрещает UPDATE записи журнала', async () => {
    await insertAuditRow();
    const error = await errorOf(() => pool.query(`UPDATE order_audit_log SET actor = 'подделка'`));
    expect(error.message).toContain('append-only');
  });

  it('запрещает DELETE записи журнала', async () => {
    await insertAuditRow();
    const error = await errorOf(() => pool.query('DELETE FROM order_audit_log'));
    expect(error.message).toContain('append-only');
  });
});

describe('нормализация адреса', () => {
  const addresses = [
    'пр-т Королёва, д. 12/3, кв. 45!',
    'ул. Ленина,  д.5',
    '  Tverskaya St. 7  ',
    'наб. реки Фонтанки, 21',
  ];

  it.each(addresses)('SQL-функция совпадает с normalizeSearchQuery для «%s»', async (address) => {
    const { rows } = await pool.query<{ normalized: string }>(
      'SELECT normalize_address($1) AS normalized',
      [address],
    );
    expect(rows[0]?.normalized).toBe(normalizeSearchQuery(address));
  });

  it('генерируемая колонка заполняется автоматически', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, {
      restaurantId: restaurant.id,
      deliveryAddress: 'пр-т Королёва, д. 12',
    });

    const { rows } = await pool.query<{ normalized: string }>(
      'SELECT delivery_address_normalized AS normalized FROM orders WHERE id = $1',
      [order.id],
    );
    expect(rows[0]?.normalized).toBe('пр-т королева д 12');
  });

  it('пересчитывается при изменении адреса', async () => {
    const restaurant = await insertRestaurant(pool);
    const order = await insertOrder(pool, { restaurantId: restaurant.id });

    const { rows } = await pool.query<{ normalized: string }>(
      `UPDATE orders SET delivery_address = 'ул. Новая, 7' WHERE id = $1
       RETURNING delivery_address_normalized AS normalized`,
      [order.id],
    );
    expect(rows[0]?.normalized).toBe('ул новая 7');
  });
});

describe('нечёткий поиск по адресу', () => {
  it('находит адрес с опечатками через триграммное сходство', async () => {
    const restaurant = await insertRestaurant(pool);
    await insertOrder(pool, {
      restaurantId: restaurant.id,
      deliveryAddress: 'Ленинский проспект, д. 12',
    });
    await insertOrder(pool, { restaurantId: restaurant.id, deliveryAddress: 'ул. Мира, д. 3' });

    const { rows } = await pool.query<{ address: string; sim: number }>(
      `SELECT delivery_address AS address,
              similarity(delivery_address_normalized, normalize_address($1)) AS sim
       FROM orders
       WHERE delivery_address_normalized % normalize_address($1)
       ORDER BY sim DESC`,
      ['Лениский проспкт 12'],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.address).toBe('Ленинский проспект, д. 12');
  });

  it('игнорирует различие ё/е', async () => {
    const restaurant = await insertRestaurant(pool);
    await insertOrder(pool, { restaurantId: restaurant.id, deliveryAddress: 'пр-т Королёва, 12' });

    const { rows } = await pool.query(
      `SELECT id FROM orders WHERE delivery_address_normalized % normalize_address($1)`,
      ['Королева 12'],
    );
    expect(rows).toHaveLength(1);
  });

  it('GIN-индекс применим к поисковому запросу', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // На пустой таблице планировщик всегда выберет seq scan, поэтому
      // проверяем именно применимость индекса к форме запроса.
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM orders WHERE delivery_address_normalized % normalize_address($1)`,
        ['ленина 5'],
      );
      const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
      expect(plan).toContain('idx_orders_address_trgm');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});

describe('индекс активных заказов курьера', () => {
  it('частичный индекс применим к подсчёту загрузки', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT count(*) FROM orders
         WHERE courier_id = $1 AND status IN ('ready', 'picked_up')`,
        ['00000000-0000-4000-8000-000000000000'],
      );
      const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
      expect(plan).toContain('idx_orders_active_by_courier');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('считает активными только ready и picked_up', async () => {
    const restaurant = await insertRestaurant(pool);
    const courier = await insertCourier(pool);
    const statuses = ['new', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered'];

    for (const status of statuses) {
      await insertOrder(pool, { restaurantId: restaurant.id, courierId: courier.id, status });
    }

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM orders
       WHERE courier_id = $1 AND status IN ('ready', 'picked_up')`,
      [courier.id],
    );
    expect(Number(rows[0]!.count)).toBe(2);
  });
});
