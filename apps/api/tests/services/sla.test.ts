import { DEFAULT_STATUS_SLA_SECONDS, listOrdersQuerySchema, slaLimitFor } from '@food/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DbPool } from '../../src/db/pool.js';
import { OrderService } from '../../src/services/order-service.js';
import {
  createTestPool,
  insertCourier,
  insertOrder,
  insertRestaurant,
  truncateAll,
  type SeedRestaurant,
} from '../helpers/test-db.js';
import { actor, createTestService } from '../helpers/service.js';

const pool: DbPool = createTestPool('sla-test');
const service = createTestService(pool);

let restaurant: SeedRestaurant;

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
  restaurant = await insertRestaurant(pool, { name: 'Пушкин' });
});

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function query(input: Record<string, unknown> = {}) {
  return listOrdersQuerySchema.parse(input);
}

/** Заказ, давно висящий в своём статусе. */
async function staleOrder(status: string, minutes: number, courierId?: string) {
  return insertOrder(pool, {
    restaurantId: restaurant.id,
    status,
    ...(courierId ? { courierId } : {}),
    createdAt: minutesAgo(minutes + 5),
    statusChangedAt: minutesAgo(minutes),
  });
}

describe('время в статусе', () => {
  it('у только что созданного заказа близко к нулю', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const order = await service.getById(created.id);

    expect(order.secondsInStatus).toBeLessThan(5);
    expect(order.slaState).toBe('ok');
  });

  it('считается от смены статуса, а не от изменения заказа', async () => {
    const courier = await insertCourier(pool, { name: 'Иван' });
    const created = await staleOrder('accepted', 30);

    // Назначение курьера меняет заказ, но не статус.
    await service.assignCourier(created.id, courier.id, created.version, actor());
    const order = await service.getById(created.id);

    expect(order.secondsInStatus).toBeGreaterThan(29 * 60);
    expect(order.courier?.name).toBe('Иван');
  });

  it('обнуляется при переходе в следующий статус', async () => {
    const created = await staleOrder('new', 30);
    const updated = await service.changeStatus(
      created.id,
      { status: 'accepted' },
      created.version,
      actor(),
    );

    expect(updated.secondsInStatus).toBeLessThan(5);
  });
});

describe('признак просрочки', () => {
  it('в пределах норматива статус ok', async () => {
    const created = await staleOrder('preparing', 1);
    expect((await service.getById(created.id)).slaState).toBe('ok');
  });

  it('на подходе к нормативу — предупреждение', async () => {
    const limitMinutes = slaLimitFor('preparing')! / 60;
    const created = await staleOrder('preparing', Math.ceil(limitMinutes * 0.9));
    expect((await service.getById(created.id)).slaState).toBe('warning');
  });

  it('после норматива — просрочка', async () => {
    const limitMinutes = slaLimitFor('preparing')! / 60;
    const created = await staleOrder('preparing', limitMinutes + 10);

    const order = await service.getById(created.id);
    expect(order.slaState).toBe('overdue');
    expect(order.slaLimitSeconds).toBe(DEFAULT_STATUS_SLA_SECONDS.preparing);
  });

  it('у терминальных статусов норматива нет', async () => {
    const courier = await insertCourier(pool);
    const delivered = await staleOrder('delivered', 5000, courier.id);

    const order = await service.getById(delivered.id);
    expect(order.slaState).toBe('none');
    expect(order.slaLimitSeconds).toBeNull();
  });

  it('уважает переопределённые нормативы', async () => {
    const strict = new OrderService(pool, {
      courierActiveLimit: 3,
      searchSimilarityThreshold: 0.5,
      statusSla: { ...DEFAULT_STATUS_SLA_SECONDS, preparing: 60 },
    });

    const created = await staleOrder('preparing', 5);

    expect((await service.getById(created.id)).slaState).toBe('ok');
    expect((await strict.getById(created.id)).slaState).toBe('overdue');
  });
});

describe('фильтр просроченных', () => {
  async function seedMixed() {
    const courier = await insertCourier(pool);
    // Просрочены: preparing 40 мин (норма 25) и new 20 мин (норма 5).
    await staleOrder('preparing', 40);
    await staleOrder('new', 20);
    // В норме.
    await staleOrder('preparing', 2);
    await staleOrder('accepted', 1);
    // Терминальные не просрочиваются никогда.
    await staleOrder('delivered', 10_000, courier.id);
  }

  it('оставляет только заказы за пределами норматива', async () => {
    await seedMixed();
    const page = await service.list(query({ overdue: 'true' }));

    expect(page.total).toBe(2);
    expect(page.items.every((item) => item.slaState === 'overdue')).toBe(true);
  });

  it('overdue=false исключает просроченные, но оставляет терминальные', async () => {
    await seedMixed();
    const page = await service.list(query({ overdue: 'false' }));

    expect(page.total).toBe(3);
    expect(page.items.some((item) => item.status === 'delivered')).toBe(true);
    expect(page.items.every((item) => item.slaState !== 'overdue')).toBe(true);
  });

  it('комбинируется с фильтром по статусу', async () => {
    await seedMixed();
    const page = await service.list(query({ overdue: 'true', status: 'preparing' }));

    expect(page.total).toBe(1);
    expect(page.items[0]?.status).toBe('preparing');
  });

  it('без фильтра отдаёт все заказы', async () => {
    await seedMixed();
    expect((await service.list(query())).total).toBe(5);
  });
});

describe('сортировка по времени в статусе', () => {
  it('дольше всех висящие заказы идут первыми', async () => {
    await staleOrder('preparing', 5);
    await staleOrder('preparing', 60);
    await staleOrder('preparing', 20);

    const page = await service.list(query({ sort: 'timeInStatus' }));
    const seconds = page.items.map((item) => item.secondsInStatus);

    expect(seconds[0]).toBeGreaterThan(seconds[1]!);
    expect(seconds[1]).toBeGreaterThan(seconds[2]!);
  });

  it('обратный порядок ставит первыми самые свежие', async () => {
    await staleOrder('preparing', 5);
    await staleOrder('preparing', 60);

    const page = await service.list(query({ sort: 'timeInStatus', order: 'asc' }));
    expect(page.items[0]?.secondsInStatus).toBeLessThan(page.items[1]!.secondsInStatus);
  });
});
