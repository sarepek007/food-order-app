import { IDEMPOTENCY_TTL_HOURS, canonicalizeRequestBody } from '@food/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';
import type { DbPool } from '../../src/db/pool.js';
import {
  deleteExpiredIdempotencyKeys,
  findIdempotencyRecord,
} from '../../src/repositories/idempotency-repository.js';
import type { IdempotencyContext } from '../../src/services/order-service.js';
import {
  createTestPool,
  insertCourier,
  insertOrder,
  insertRestaurant,
  truncateAll,
  type SeedRestaurant,
} from '../helpers/test-db.js';
import { actor, captureError, createTestService } from '../helpers/service.js';

const pool: DbPool = createTestPool('idempotency-test');
const service = createTestService(pool);
const db = createDatabase(pool);

let restaurant: SeedRestaurant;

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE idempotency_keys');
  await truncateAll(pool);
  restaurant = await insertRestaurant(pool);
});

let sequence = 0;

/** Ключ с отметкой о воспроизведении — по ней проверяем, был ли повтор. */
function idempotencyKey(hash = 'hash-a'): IdempotencyContext & { replayed: boolean } {
  sequence += 1;
  const context = {
    key: `test-key-${sequence}-${Date.now()}`,
    requestHash: hash,
    replayed: false,
    onReplay: () => {
      context.replayed = true;
    },
  };
  return context;
}

async function auditCount(orderId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM order_audit_log WHERE order_id = $1',
    [orderId],
  );
  return Number(rows[0]!.count);
}

describe('повтор запроса с тем же ключом', () => {
  it('не создаёт второй переход и вторую запись в журнале', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const key = idempotencyKey();

    const first = await service.changeStatus(
      created.id,
      { status: 'accepted' },
      created.version,
      actor(),
      key,
    );
    const second = await service.changeStatus(
      created.id,
      { status: 'accepted' },
      created.version,
      actor(),
      key,
    );

    expect(first.version).toBe(2);
    expect(second.version).toBe(2);
    expect(second).toEqual(first);
    expect(key.replayed).toBe(true);
    expect(await auditCount(created.id)).toBe(1);
  });

  it('без ключа повтор упирается в конфликт версий, а не проходит дважды', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });

    await service.changeStatus(created.id, { status: 'accepted' }, created.version, actor());
    const error = await captureError(() =>
      service.changeStatus(created.id, { status: 'accepted' }, created.version, actor()),
    );

    expect(error.code).toBe('ORDER_VERSION_CONFLICT');
  });

  it('воспроизводит результат создания заказа, а не создаёт второй', async () => {
    const key = idempotencyKey();
    const input = {
      customerName: 'Пётр Клиентов',
      restaurantId: restaurant.id,
      deliveryAddress: 'ул. Ленина, д. 5',
      totalAmount: '100.00',
      currency: 'RUB',
    };

    const first = await service.create(input, actor(), key);
    const second = await service.create(input, actor(), key);

    expect(second.id).toBe(first.id);
    expect(key.replayed).toBe(true);

    const { rows } = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM orders');
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it('воспроизводит отмену вместе с причиной', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const key = idempotencyKey();

    const first = await service.cancel(
      created.id,
      { reason: 'клиент передумал' },
      created.version,
      actor(),
      key,
    );
    const second = await service.cancel(
      created.id,
      { reason: 'клиент передумал' },
      created.version,
      actor(),
      key,
    );

    expect(second.cancelReason).toBe('клиент передумал');
    expect(second).toEqual(first);
    expect(await auditCount(created.id)).toBe(1);
  });

  it('назначение курьера воспроизводится без второй записи', async () => {
    const courier = await insertCourier(pool, { name: 'Иван' });
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const key = idempotencyKey();

    await service.assignCourier(created.id, courier.id, created.version, actor(), key);
    const second = await service.assignCourier(
      created.id,
      courier.id,
      created.version,
      actor(),
      key,
    );

    expect(second.courier?.name).toBe('Иван');
    expect(await auditCount(created.id)).toBe(1);
  });
});

describe('тот же ключ с другим запросом', () => {
  it('отклоняется как ошибка клиента', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const key = idempotencyKey('hash-a');

    await service.changeStatus(created.id, { status: 'accepted' }, created.version, actor(), key);

    const error = await captureError(() =>
      service.changeStatus(created.id, { status: 'preparing' }, 2, actor(), {
        ...key,
        requestHash: 'hash-b',
      }),
    );

    expect(error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(error.httpStatus).toBe(409);
    expect(error.message).toContain(key.key);
  });

  it('не применяет изменение при повторном использовании ключа', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const key = idempotencyKey('hash-a');

    await service.changeStatus(created.id, { status: 'accepted' }, created.version, actor(), key);
    await captureError(() =>
      service.changeStatus(created.id, { status: 'preparing' }, 2, actor(), {
        ...key,
        requestHash: 'hash-b',
      }),
    );

    expect((await service.getById(created.id)).status).toBe('accepted');
  });
});

describe('параллельные повторы', () => {
  it('из десяти одновременных запросов применяется ровно один', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const key = idempotencyKey();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.changeStatus(created.id, { status: 'accepted' }, created.version, actor(), {
          ...key,
        }),
      ),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');

    // Все запросы завершились успешно — но изменение применено один раз.
    expect(fulfilled).toHaveLength(10);
    expect(await auditCount(created.id)).toBe(1);
    expect((await service.getById(created.id)).version).toBe(2);
  });

  it('все параллельные ответы одинаковы', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const key = idempotencyKey();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.changeStatus(created.id, { status: 'accepted' }, created.version, actor(), {
          ...key,
        }),
      ),
    );

    // Сравнение по канонической форме: jsonb не сохраняет порядок ключей,
    // поэтому воспроизведённый ответ приходит с другим их порядком.
    const serialized = new Set(results.map((result) => canonicalizeRequestBody(result)));
    expect(serialized.size).toBe(1);
  });
});

describe('хранение ключей', () => {
  it('сохраняет ответ, автора и заказ', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const key = idempotencyKey();

    await service.changeStatus(
      created.id,
      { status: 'accepted' },
      created.version,
      actor('Анна Петрова'),
      key,
    );

    const stored = await findIdempotencyRecord(db, key.key);
    expect(stored).toMatchObject({
      requestHash: key.requestHash,
      responseStatus: 200,
      orderId: created.id,
      actor: 'Анна Петрова',
    });
  });

  it('срок жизни ключа ограничен', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const key = idempotencyKey();
    await service.changeStatus(created.id, { status: 'accepted' }, created.version, actor(), key);

    const { rows } = await pool.query<{ hours: string }>(
      'SELECT extract(epoch FROM (expires_at - created_at)) / 3600 AS hours FROM idempotency_keys WHERE key = $1',
      [key.key],
    );
    expect(Math.round(Number(rows[0]!.hours))).toBe(IDEMPOTENCY_TTL_HOURS);
  });

  it('просроченный ключ не воспроизводится, а выполняется заново', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const key = idempotencyKey();
    await service.changeStatus(created.id, { status: 'accepted' }, created.version, actor(), key);

    // Ограничение expires_at > created_at не даёт «состарить» только срок —
    // сдвигаем обе отметки, как это выглядело бы у настоящей старой записи.
    await pool.query(
      `UPDATE idempotency_keys
       SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'`,
    );

    expect(await findIdempotencyRecord(db, key.key)).toBeUndefined();
  });

  it('уборка удаляет только просроченные ключи', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const fresh = idempotencyKey();
    const stale = idempotencyKey();

    await service.changeStatus(created.id, { status: 'accepted' }, created.version, actor(), fresh);
    await service.changeStatus(created.id, { status: 'preparing' }, 2, actor(), stale);
    await pool.query(
      `UPDATE idempotency_keys
       SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
       WHERE key = $1`,
      [stale.key],
    );

    expect(await deleteExpiredIdempotencyKeys(db)).toBe(1);
    expect(await findIdempotencyRecord(db, fresh.key)).toBeDefined();
  });
});
