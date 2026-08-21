import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbPool } from '../../src/db/pool.js';
import { runSeed, type SeedSummary } from '../../src/seed/seed.js';
import { buildSeedPlan } from '../../src/seed/plan.js';
import { createTestPool } from '../helpers/test-db.js';
import { createTestService } from '../helpers/service.js';
import { listOrdersQuerySchema } from '@food/contracts';

const pool: DbPool = createTestPool('seed-test');
const service = createTestService(pool);
const NOW = new Date('2026-05-21T12:00:00.000Z');

let summary: SeedSummary;

beforeAll(async () => {
  summary = await runSeed(pool, { now: NOW, courierActiveLimit: 3 });
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ value: string }>(sql, params);
  return Number(rows[0]?.value ?? 0);
}

describe('объём загруженных данных', () => {
  it('создаёт 20 ресторанов, 20 курьеров и 200 заказов', async () => {
    expect(await scalar('SELECT count(*)::text AS value FROM restaurants')).toBe(20);
    expect(await scalar('SELECT count(*)::text AS value FROM couriers')).toBe(20);
    expect(await scalar('SELECT count(*)::text AS value FROM orders')).toBe(200);
  });

  it('журнал заполнен для каждого заказа', async () => {
    const withoutAudit = await scalar(
      `SELECT count(*)::text AS value FROM orders o
       WHERE NOT EXISTS (SELECT 1 FROM order_audit_log a WHERE a.order_id = o.id)`,
    );
    expect(withoutAudit).toBe(0);
    expect(await scalar('SELECT count(*)::text AS value FROM order_audit_log')).toBe(
      summary.auditEntries,
    );
  });

  it('у каждого заказа есть запись о создании', async () => {
    const created = await scalar(
      `SELECT count(*)::text AS value FROM order_audit_log WHERE action = 'ORDER_CREATED'`,
    );
    expect(created).toBe(200);
  });

  it('заказы распределены по всем статусам', async () => {
    const { rows } = await pool.query<{ status: string; count: string }>(
      'SELECT status::text AS status, count(*)::text AS count FROM orders GROUP BY status',
    );
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(Number(row.count), `статус ${row.status}`).toBeGreaterThan(0);
    }
  });

  it('заказы распределены по разным ресторанам и курьерам', async () => {
    expect(await scalar('SELECT count(DISTINCT restaurant_id)::text AS value FROM orders')).toBe(20);
    expect(
      await scalar('SELECT count(DISTINCT courier_id)::text AS value FROM orders WHERE courier_id IS NOT NULL'),
    ).toBeGreaterThan(10);
  });

  it('часть заказов оставлена без курьера', async () => {
    const unassigned = await scalar(
      'SELECT count(*)::text AS value FROM orders WHERE courier_id IS NULL',
    );
    expect(unassigned).toBeGreaterThan(10);
    expect(unassigned).toBe(summary.unassignedOrders);
  });
});

describe('доменные инварианты в базе', () => {
  it('ни один курьер не превышает лимит активных доставок', async () => {
    const overloaded = await scalar(
      `SELECT count(*)::text AS value FROM (
         SELECT courier_id FROM orders
         WHERE status IN ('ready', 'picked_up')
         GROUP BY courier_id HAVING count(*) > 3
       ) AS t`,
    );
    expect(overloaded).toBe(0);
  });

  it('у заказов от ready и дальше назначен курьер', async () => {
    const orphans = await scalar(
      `SELECT count(*)::text AS value FROM orders
       WHERE status IN ('ready', 'picked_up', 'delivered') AND courier_id IS NULL`,
    );
    expect(orphans).toBe(0);
  });

  it('у всех отменённых заказов указана причина', async () => {
    const withoutReason = await scalar(
      `SELECT count(*)::text AS value FROM orders
       WHERE status = 'cancelled' AND (cancel_reason IS NULL OR btrim(cancel_reason) = '')`,
    );
    expect(withoutReason).toBe(0);
  });

  it('активные заказы не назначены неактивным курьерам', async () => {
    const invalid = await scalar(
      `SELECT count(*)::text AS value FROM orders o
       JOIN couriers c ON c.id = o.courier_id
       WHERE o.status IN ('ready', 'picked_up') AND c.is_active = false`,
    );
    expect(invalid).toBe(0);
  });

  it('updated_at не раньше created_at и не в будущем', async () => {
    const broken = await scalar(
      `SELECT count(*)::text AS value FROM orders
       WHERE updated_at < created_at OR created_at > now()`,
    );
    expect(broken).toBe(0);
  });
});

describe('согласованность журнала и заказа', () => {
  it('версия заказа совпадает с числом записей журнала', async () => {
    const mismatched = await scalar(
      `SELECT count(*)::text AS value FROM orders o
       JOIN (SELECT order_id, count(*) AS events, max(order_version) AS last_version
             FROM order_audit_log GROUP BY order_id) a ON a.order_id = o.id
       WHERE o.version <> a.events OR o.version <> a.last_version`,
    );
    expect(mismatched).toBe(0);
  });

  it('последнее событие журнала совпадает с текущим статусом', async () => {
    const mismatched = await scalar(
      `SELECT count(*)::text AS value FROM orders o
       JOIN LATERAL (
         SELECT new_status FROM order_audit_log
         WHERE order_id = o.id AND new_status IS NOT NULL
         ORDER BY order_version DESC LIMIT 1
       ) last ON true
       WHERE last.new_status <> o.status`,
    );
    expect(mismatched).toBe(0);
  });

  it('время событий не выходит за границы жизни заказа', async () => {
    const broken = await scalar(
      `SELECT count(*)::text AS value FROM order_audit_log a
       JOIN orders o ON o.id = a.order_id
       WHERE a.created_at < o.created_at OR a.created_at > o.updated_at`,
    );
    expect(broken).toBe(0);
  });

  it('журнал содержит назначения курьеров', async () => {
    const assignments = await scalar(
      `SELECT count(*)::text AS value FROM order_audit_log
       WHERE action IN ('COURIER_ASSIGNED', 'COURIER_CHANGED')`,
    );
    expect(assignments).toBeGreaterThan(50);
  });
});

describe('состояние схемы после загрузки', () => {
  it('триггер версионирования снова включён', async () => {
    const { rows } = await pool.query<{ tgenabled: string }>(
      `SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_orders_bump_version'`,
    );
    expect(rows[0]?.tgenabled).toBe('O');
  });

  it('версия по-прежнему инкрементируется при изменении', async () => {
    const { rows } = await pool.query<{ id: string; version: number }>(
      `SELECT id, version FROM orders WHERE status = 'new' LIMIT 1`,
    );
    const order = rows[0]!;

    const updated = await pool.query<{ version: number }>(
      `UPDATE orders SET customer_name = customer_name || ' (правка)' WHERE id = $1 RETURNING version`,
      [order.id],
    );
    expect(updated.rows[0]?.version).toBe(order.version + 1);
  });
});

describe('данные пригодны для демонстрации', () => {
  it('нечёткий поиск находит адрес с опечатками', async () => {
    const page = await service.list(listOrdersQuerySchema.parse({ q: 'Лениский проспкт' }));
    expect(page.total).toBeGreaterThan(0);
  });

  it('поиск не зависит от ё/е', async () => {
    const withYo = await service.list(listOrdersQuerySchema.parse({ q: 'Королёва' }));
    const withoutYo = await service.list(listOrdersQuerySchema.parse({ q: 'Королева' }));
    expect(withYo.total).toBeGreaterThan(0);
    expect(withoutYo.total).toBe(withYo.total);
  });

  it('на первой странице списка достаточно заказов для проверки интерфейса', async () => {
    const page = await service.list(listOrdersQuerySchema.parse({}));
    expect(page.items).toHaveLength(25);
    expect(page.totalPages).toBe(8);
  });

  it('есть курьеры и со свободными слотами, и загруженные под завязку', async () => {
    const couriers = await service.listCouriers();
    expect(couriers.some((courier) => courier.activeOrdersCount > 0)).toBe(true);
    expect(couriers.some((courier) => courier.hasCapacity)).toBe(true);
  });

  it('журнал заказа читается через сервис', async () => {
    const page = await service.list(listOrdersQuerySchema.parse({ status: 'delivered', pageSize: '1' }));
    const audit = await service.getAudit(page.items[0]!.id, { order: 'asc', page: 1, pageSize: 50 });

    expect(audit.total).toBeGreaterThanOrEqual(6);
    expect(audit.items[0]?.action).toBe('ORDER_CREATED');
    expect(audit.items.at(-1)?.newStatus).toBe('delivered');
  });
});

describe('повторный запуск', () => {
  it('идемпотентен: те же данные и те же идентификаторы', async () => {
    const before = await pool.query<{ id: string }>('SELECT id FROM orders ORDER BY created_at LIMIT 5');

    await runSeed(pool, { now: NOW, courierActiveLimit: 3 });

    const after = await pool.query<{ id: string }>('SELECT id FROM orders ORDER BY created_at LIMIT 5');
    expect(after.rows).toEqual(before.rows);
    expect(await scalar('SELECT count(*)::text AS value FROM orders')).toBe(200);
  }, 60_000);

  it('другое зерно даёт другой набор данных', async () => {
    const other = buildSeedPlan({ now: NOW, seed: 999 });
    const current = buildSeedPlan({ now: NOW });
    expect(other.orders[0]?.id).not.toBe(current.orders[0]?.id);
  });
});
