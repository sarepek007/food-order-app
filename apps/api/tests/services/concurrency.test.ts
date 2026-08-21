import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/db/client.js';
import { orders } from '../../src/db/schema.js';
import { withTransaction, type DbPool } from '../../src/db/pool.js';
import type { OrderService } from '../../src/services/order-service.js';
import {
  createTestPool,
  insertCourier,
  insertOrder,
  insertRestaurant,
  truncateAll,
  type SeedRestaurant,
} from '../helpers/test-db.js';
import { TEST_COURIER_LIMIT, actor, captureError, createTestService } from '../helpers/service.js';

const pool: DbPool = createTestPool('concurrency-test');
const service: OrderService = createTestService(pool);
const db = createDatabase(pool);

let restaurant: SeedRestaurant;

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
  restaurant = await insertRestaurant(pool);
});

/** Разбирает результаты Promise.allSettled на успехи и доменные коды ошибок. */
function partition(results: PromiseSettledResult<unknown>[]): {
  fulfilled: number;
  codes: string[];
} {
  const codes = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => (result.reason as { code?: string }).code ?? 'UNKNOWN');

  return { fulfilled: results.filter((result) => result.status === 'fulfilled').length, codes };
}

describe('сценарий из ТЗ: два оператора и один заказ', () => {
  it('изменение пользователя A не перетирает более свежее изменение B', async () => {
    const alex = await insertCourier(pool, { name: 'Alex' });
    const maria = await insertCourier(pool, { name: 'Maria' });
    const created = await service.create(
      {
        customerName: 'Клиент',
        restaurantId: restaurant.id,
        deliveryAddress: 'ул. Ленина, д. 5',
        totalAmount: '500.00',
        currency: 'RUB',
      },
      actor('система'),
    );

    // Оба оператора открыли заказ и видят одну и ту же версию.
    const seenByA = await service.getById(created.id);
    const seenByB = await service.getById(created.id);
    expect(seenByA.version).toBe(seenByB.version);

    // B назначает Alex — заказ переходит на следующую версию.
    const afterB = await service.assignCourier(seenByB.id, alex.id, seenByB.version, actor('B'));
    expect(afterB.courier?.name).toBe('Alex');

    // A всё ещё держит старую версию и назначает Maria.
    const error = await captureError(() =>
      service.assignCourier(seenByA.id, maria.id, seenByA.version, actor('A')),
    );

    expect(error.code).toBe('ORDER_VERSION_CONFLICT');
    expect(error.httpStatus).toBe(409);

    // Изменение B сохранилось, изменение A не применилось.
    const current = await service.getById(created.id);
    expect(current.courier?.name).toBe('Alex');
    expect(current.version).toBe(afterB.version);
  });

  it('в ошибке конфликта приходит актуальное состояние и объяснение', async () => {
    const alex = await insertCourier(pool, { name: 'Alex' });
    const maria = await insertCourier(pool, { name: 'Maria' });
    const created = await service.create(
      {
        customerName: 'Клиент',
        restaurantId: restaurant.id,
        deliveryAddress: 'ул. Ленина, д. 5',
        totalAmount: '500.00',
        currency: 'RUB',
      },
      actor('система'),
    );

    const stale = await service.getById(created.id);
    await service.assignCourier(created.id, alex.id, stale.version, actor('оператор B'));

    const error = await captureError(() =>
      service.assignCourier(created.id, maria.id, stale.version, actor('оператор A')),
    );

    expect(error.details).toMatchObject({
      expectedVersion: stale.version,
      actualVersion: stale.version + 1,
      changedFields: ['courierId'],
    });
    expect(error.details?.['changes']).toEqual(['назначен курьер Alex']);
    expect(error.message).toContain('оператор B');

    // Клиенту не нужен второй запрос: актуальный заказ уже в ответе.
    const current = error.details?.['current'] as { courier: { name: string }; version: number };
    expect(current.courier.name).toBe('Alex');
    expect(current.version).toBe(stale.version + 1);
  });

  it('объясняет несколько изменений подряд', async () => {
    const alex = await insertCourier(pool, { name: 'Alex' });
    const created = await service.create(
      {
        customerName: 'Клиент',
        restaurantId: restaurant.id,
        deliveryAddress: 'ул. Ленина, д. 5',
        totalAmount: '500.00',
        currency: 'RUB',
      },
      actor('система'),
    );
    const stale = await service.getById(created.id);

    const assigned = await service.assignCourier(created.id, alex.id, stale.version, actor('B'));
    await service.changeStatus(assigned.id, { status: 'accepted' }, assigned.version, actor('B'));

    const error = await captureError(() =>
      service.changeStatus(created.id, { status: 'accepted' }, stale.version, actor('A')),
    );

    expect(error.code).toBe('ORDER_VERSION_CONFLICT');
    expect(error.details?.['changes']).toEqual([
      'назначен курьер Alex',
      'статус «Новый» → «Принят»',
    ]);
    expect(error.details?.['changedFields']).toEqual(expect.arrayContaining(['courierId', 'status']));
  });

  it('конфликт при отмене заказа тоже обнаруживается', async () => {
    const created = await service.create(
      {
        customerName: 'Клиент',
        restaurantId: restaurant.id,
        deliveryAddress: 'ул. Ленина, д. 5',
        totalAmount: '500.00',
        currency: 'RUB',
      },
      actor('система'),
    );
    const stale = await service.getById(created.id);
    await service.changeStatus(created.id, { status: 'accepted' }, stale.version, actor('B'));

    const error = await captureError(() =>
      service.cancel(created.id, { reason: 'клиент передумал' }, stale.version, actor('A')),
    );

    expect(error.code).toBe('ORDER_VERSION_CONFLICT');
    expect((await service.getById(created.id)).status).toBe('accepted');
  });
});

describe('параллельные изменения одного заказа', () => {
  it('из двух одновременных переходов применяется ровно один', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });

    const results = await Promise.allSettled([
      service.changeStatus(created.id, { status: 'accepted' }, created.version, actor('A')),
      service.changeStatus(created.id, { status: 'accepted' }, created.version, actor('B')),
    ]);

    const { fulfilled, codes } = partition(results);
    expect(fulfilled).toBe(1);
    expect(codes).toEqual(['ORDER_VERSION_CONFLICT']);

    const audit = await service.getAudit(created.id, { order: 'asc', page: 1, pageSize: 50 });
    expect(audit.items.filter((entry) => entry.action === 'STATUS_CHANGED')).toHaveLength(1);
  });

  it('десять одновременных назначений курьера дают одну запись в журнале', async () => {
    const courier = await insertCourier(pool, { name: 'Иван' });
    const created = await insertOrder(pool, { restaurantId: restaurant.id });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        service.assignCourier(created.id, courier.id, created.version, actor(`оператор-${index}`)),
      ),
    );

    const { fulfilled } = partition(results);
    expect(fulfilled).toBe(1);

    const audit = await service.getAudit(created.id, { order: 'asc', page: 1, pageSize: 50 });
    expect(audit.items.filter((entry) => entry.action.startsWith('COURIER_'))).toHaveLength(1);
  });
});

describe('лимит активных доставок под нагрузкой', () => {
  it('пять параллельных переходов в ready на одного курьера дают ровно три успеха', async () => {
    const courier = await insertCourier(pool, { name: 'Иван' });
    const prepared = await Promise.all(
      Array.from({ length: 5 }, () =>
        insertOrder(pool, {
          restaurantId: restaurant.id,
          courierId: courier.id,
          status: 'preparing',
        }),
      ),
    );

    const results = await Promise.allSettled(
      prepared.map((order) =>
        service.changeStatus(order.id, { status: 'ready' }, order.version, actor()),
      ),
    );

    const { fulfilled, codes } = partition(results);
    expect(fulfilled).toBe(TEST_COURIER_LIMIT);
    expect(codes).toEqual(
      Array.from({ length: 5 - TEST_COURIER_LIMIT }, () => 'COURIER_CAPACITY_EXCEEDED'),
    );

    const active = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.courierId, courier.id));
    const readyCount = (
      await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM orders
         WHERE courier_id = $1 AND status IN ('ready','picked_up')`,
        [courier.id],
      )
    ).rows[0]!.count;

    expect(active).toHaveLength(5);
    expect(Number(readyCount)).toBe(TEST_COURIER_LIMIT);
  });

  it('пять параллельных назначений на активные заказы не превышают лимит', async () => {
    const target = await insertCourier(pool, { name: 'Целевой' });
    const readyOrders = await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const other = await insertCourier(pool, { name: `Курьер-${index}` });
        return insertOrder(pool, {
          restaurantId: restaurant.id,
          courierId: other.id,
          status: 'ready',
        });
      }),
    );

    const results = await Promise.allSettled(
      readyOrders.map((order) => service.assignCourier(order.id, target.id, order.version, actor())),
    );

    const { fulfilled, codes } = partition(results);
    expect(fulfilled).toBe(TEST_COURIER_LIMIT);
    expect(new Set(codes)).toEqual(new Set(['COURIER_CAPACITY_EXCEEDED']));

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM orders
       WHERE courier_id = $1 AND status IN ('ready','picked_up')`,
      [target.id],
    );
    expect(Number(rows[0]!.count)).toBe(TEST_COURIER_LIMIT);
  });

  it('блокировка берётся по курьеру, а не глобально', async () => {
    const first = await insertCourier(pool, { name: 'Первый' });
    const second = await insertCourier(pool, { name: 'Второй' });

    const prepared = await Promise.all(
      [first, second].flatMap((courier) =>
        Array.from({ length: TEST_COURIER_LIMIT }, () =>
          insertOrder(pool, {
            restaurantId: restaurant.id,
            courierId: courier.id,
            status: 'preparing',
          }),
        ),
      ),
    );

    const results = await Promise.allSettled(
      prepared.map((order) =>
        service.changeStatus(order.id, { status: 'ready' }, order.version, actor()),
      ),
    );

    // Курьеры независимы: оба набора заказов проходят целиком.
    expect(partition(results).fulfilled).toBe(TEST_COURIER_LIMIT * 2);
  });
});

describe('атомарность', () => {
  it('ошибка внутри транзакции откатывает и заказ, и журнал', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });

    await expect(
      withTransaction(pool, async (client) => {
        await client.query(`UPDATE orders SET status = 'accepted' WHERE id = $1`, [created.id]);
        await client.query(
          `INSERT INTO order_audit_log (order_id, action, new_status, actor, order_version)
           VALUES ($1, 'STATUS_CHANGED', 'accepted', 'tester', 2)`,
          [created.id],
        );
        throw new Error('сбой после записи');
      }),
    ).rejects.toThrow('сбой после записи');

    const order = await service.getById(created.id);
    const audit = await service.getAudit(created.id, { order: 'asc', page: 1, pageSize: 10 });

    expect(order.status).toBe('new');
    expect(order.version).toBe(1);
    expect(audit.total).toBe(0);
  });

  it('отклонение по лимиту не оставляет изменений', async () => {
    const courier = await insertCourier(pool, { name: 'Иван' });
    for (let index = 0; index < TEST_COURIER_LIMIT; index += 1) {
      await insertOrder(pool, {
        restaurantId: restaurant.id,
        courierId: courier.id,
        status: 'ready',
      });
    }
    const extra = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'preparing',
    });

    await captureError(() =>
      service.changeStatus(extra.id, { status: 'ready' }, extra.version, actor()),
    );

    const order = await service.getById(extra.id);
    const audit = await service.getAudit(extra.id, { order: 'asc', page: 1, pageSize: 10 });

    expect(order.status).toBe('preparing');
    expect(order.version).toBe(extra.version);
    expect(audit.total).toBe(0);
  });
});
