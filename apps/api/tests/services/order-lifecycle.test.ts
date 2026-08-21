import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DbPool } from '../../src/db/pool.js';
import type { OrderService } from '../../src/services/order-service.js';
import {
  createTestPool,
  insertCourier,
  insertOrder,
  insertRestaurant,
  truncateAll,
  type SeedCourier,
  type SeedRestaurant,
} from '../helpers/test-db.js';
import { actor, captureError, createTestService } from '../helpers/service.js';

const pool: DbPool = createTestPool('lifecycle-test');
const service: OrderService = createTestService(pool);

let restaurant: SeedRestaurant;
let courier: SeedCourier;

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
  restaurant = await insertRestaurant(pool, { name: 'Пушкин' });
  courier = await insertCourier(pool, { name: 'Иван' });
});

async function createOrder(overrides: Partial<{ address: string; amount: string }> = {}) {
  return service.create(
    {
      customerName: 'Пётр Клиентов',
      restaurantId: restaurant.id,
      deliveryAddress: overrides.address ?? 'ул. Ленина, д. 5',
      totalAmount: overrides.amount ?? '1290.50',
      currency: 'RUB',
    },
    actor('оператор Анна'),
  );
}

describe('создание заказа', () => {
  it('создаёт заказ в статусе new с версией 1', async () => {
    const order = await createOrder();

    expect(order).toMatchObject({
      status: 'new',
      version: 1,
      customerName: 'Пётр Клиентов',
      courier: null,
      totalAmount: '1290.50',
    });
    expect(order.restaurant.name).toBe('Пушкин');
    expect(order.publicNumber).toBeGreaterThan(0);
  });

  it('сразу пишет событие в журнал', async () => {
    const order = await createOrder();
    const audit = await service.getAudit(order.id, { order: 'asc', page: 1, pageSize: 50 });

    expect(audit.total).toBe(1);
    expect(audit.items[0]).toMatchObject({
      action: 'ORDER_CREATED',
      newStatus: 'new',
      actor: 'оператор Анна',
    });
  });

  it('отдаёт список допустимых переходов вместе с заказом', async () => {
    const order = await createOrder();
    expect(order.allowedTransitions).toEqual(['accepted', 'cancelled']);
    expect(order.cancellable).toBe(true);
  });

  it('отклоняет несуществующий ресторан', async () => {
    const error = await captureError(() =>
      service.create(
        {
          customerName: 'Пётр',
          restaurantId: '00000000-0000-4000-8000-000000000000',
          deliveryAddress: 'ул. Ленина, д. 5',
          totalAmount: '100.00',
          currency: 'RUB',
        },
        actor(),
      ),
    );

    expect(error.code).toBe('RESTAURANT_NOT_FOUND');
    expect(error.httpStatus).toBe(404);
  });

  it('отклоняет заказ в неактивный ресторан', async () => {
    const closed = await insertRestaurant(pool, { name: 'Закрытый', isActive: false });
    const error = await captureError(() =>
      service.create(
        {
          customerName: 'Пётр',
          restaurantId: closed.id,
          deliveryAddress: 'ул. Ленина, д. 5',
          totalAmount: '100.00',
          currency: 'RUB',
        },
        actor(),
      ),
    );

    expect(error.code).toBe('RESTAURANT_INACTIVE');
    expect(error.httpStatus).toBe(422);
  });
});

describe('полный жизненный цикл', () => {
  it('проводит заказ от new до delivered и фиксирует каждый шаг', async () => {
    let order = await createOrder();

    order = await service.changeStatus(order.id, { status: 'accepted' }, order.version, actor());
    expect(order.status).toBe('accepted');
    expect(order.version).toBe(2);

    order = await service.changeStatus(order.id, { status: 'preparing' }, order.version, actor());
    order = await service.assignCourier(order.id, courier.id, order.version, actor());
    expect(order.courier?.name).toBe('Иван');

    order = await service.changeStatus(order.id, { status: 'ready' }, order.version, actor());
    order = await service.changeStatus(order.id, { status: 'picked_up' }, order.version, actor());
    order = await service.changeStatus(order.id, { status: 'delivered' }, order.version, actor());

    expect(order.status).toBe('delivered');
    expect(order.allowedTransitions).toEqual([]);
    expect(order.cancellable).toBe(false);

    const audit = await service.getAudit(order.id, { order: 'asc', page: 1, pageSize: 50 });
    expect(audit.items.map((entry) => entry.action)).toEqual([
      'ORDER_CREATED',
      'STATUS_CHANGED',
      'STATUS_CHANGED',
      'COURIER_ASSIGNED',
      'STATUS_CHANGED',
      'STATUS_CHANGED',
      'STATUS_CHANGED',
    ]);
  });

  it('сохраняет в журнале старый и новый статус', async () => {
    let order = await createOrder();
    order = await service.changeStatus(
      order.id,
      { status: 'accepted', comment: 'подтверждено рестораном' },
      order.version,
      actor('Анна'),
    );

    const audit = await service.getAudit(order.id, { order: 'desc', page: 1, pageSize: 10 });
    expect(audit.items[0]).toMatchObject({
      action: 'STATUS_CHANGED',
      oldStatus: 'new',
      newStatus: 'accepted',
      comment: 'подтверждено рестораном',
      actor: 'Анна',
    });
  });

  it('отклоняет перепрыгивание через статус', async () => {
    const order = await createOrder();
    const error = await captureError(() =>
      service.changeStatus(order.id, { status: 'delivered' }, order.version, actor()),
    );

    expect(error.code).toBe('ORDER_INVALID_TRANSITION');
    expect(error.httpStatus).toBe(409);
    expect(error.details).toMatchObject({ currentStatus: 'new', requestedStatus: 'delivered' });
  });

  it('требует курьера перед переходом в ready', async () => {
    let order = await createOrder();
    order = await service.changeStatus(order.id, { status: 'accepted' }, order.version, actor());
    order = await service.changeStatus(order.id, { status: 'preparing' }, order.version, actor());

    const error = await captureError(() =>
      service.changeStatus(order.id, { status: 'ready' }, order.version, actor()),
    );

    expect(error.code).toBe('ORDER_COURIER_REQUIRED');
    expect(error.httpStatus).toBe(422);
  });

  it('не оставляет следов в журнале при отклонённом переходе', async () => {
    const order = await createOrder();
    await captureError(() =>
      service.changeStatus(order.id, { status: 'delivered' }, order.version, actor()),
    );

    const audit = await service.getAudit(order.id, { order: 'asc', page: 1, pageSize: 50 });
    expect(audit.total).toBe(1);
    expect((await service.getById(order.id)).version).toBe(1);
  });
});

describe('назначение курьера', () => {
  it('назначает курьера и пишет COURIER_ASSIGNED', async () => {
    const created = await createOrder();
    const order = await service.assignCourier(created.id, courier.id, created.version, actor());

    expect(order.courier).toEqual({ id: courier.id, name: 'Иван' });

    const audit = await service.getAudit(order.id, { order: 'desc', page: 1, pageSize: 10 });
    expect(audit.items[0]).toMatchObject({
      action: 'COURIER_ASSIGNED',
      oldCourier: null,
      newCourier: { name: 'Иван' },
    });
  });

  it('различает назначение и замену курьера', async () => {
    const maria = await insertCourier(pool, { name: 'Мария' });
    let order = await createOrder();
    order = await service.assignCourier(order.id, courier.id, order.version, actor());
    order = await service.assignCourier(order.id, maria.id, order.version, actor());

    const audit = await service.getAudit(order.id, { order: 'desc', page: 1, pageSize: 10 });
    expect(audit.items[0]).toMatchObject({
      action: 'COURIER_CHANGED',
      oldCourier: { name: 'Иван' },
      newCourier: { name: 'Мария' },
    });
  });

  it('повторное назначение того же курьера ничего не меняет', async () => {
    let order = await createOrder();
    order = await service.assignCourier(order.id, courier.id, order.version, actor());
    const versionAfterFirst = order.version;

    order = await service.assignCourier(order.id, courier.id, order.version, actor());

    expect(order.version).toBe(versionAfterFirst);
    const audit = await service.getAudit(order.id, { order: 'asc', page: 1, pageSize: 50 });
    expect(audit.items.filter((entry) => entry.action.startsWith('COURIER_'))).toHaveLength(1);
  });

  it('отклоняет неактивного курьера', async () => {
    const fired = await insertCourier(pool, { name: 'Уволенный', isActive: false });
    const order = await createOrder();

    const error = await captureError(() =>
      service.assignCourier(order.id, fired.id, order.version, actor()),
    );
    expect(error.code).toBe('COURIER_INACTIVE');
  });

  it('отклоняет несуществующего курьера', async () => {
    const order = await createOrder();
    const error = await captureError(() =>
      service.assignCourier(order.id, '00000000-0000-4000-8000-000000000000', order.version, actor()),
    );
    expect(error.code).toBe('COURIER_NOT_FOUND');
  });

  it('снимает курьера до выхода заказа в доставку', async () => {
    let order = await createOrder();
    order = await service.assignCourier(order.id, courier.id, order.version, actor());
    order = await service.unassignCourier(order.id, order.version, actor());

    expect(order.courier).toBeNull();
    const audit = await service.getAudit(order.id, { order: 'desc', page: 1, pageSize: 10 });
    expect(audit.items[0]).toMatchObject({ action: 'COURIER_UNASSIGNED', oldCourier: { name: 'Иван' } });
  });

  it('запрещает снять курьера с заказа в статусе ready', async () => {
    const ready = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'ready',
    });

    const error = await captureError(() =>
      service.unassignCourier(ready.id, ready.version, actor()),
    );
    expect(error.code).toBe('ORDER_COURIER_REQUIRED');
  });
});

describe('лимит активных доставок', () => {
  async function makeReadyOrder(courierId: string) {
    return insertOrder(pool, { restaurantId: restaurant.id, courierId, status: 'ready' });
  }

  it('пропускает третий активный заказ и отклоняет четвёртый', async () => {
    await makeReadyOrder(courier.id);
    await makeReadyOrder(courier.id);
    await makeReadyOrder(courier.id);

    const fourth = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'preparing',
    });

    const error = await captureError(() =>
      service.changeStatus(fourth.id, { status: 'ready' }, fourth.version, actor()),
    );

    expect(error.code).toBe('COURIER_CAPACITY_EXCEEDED');
    expect(error.httpStatus).toBe(409);
    expect(error.details).toMatchObject({ activeCount: 3, limit: 3 });
    expect(error.message).toContain('Иван');
  });

  it('не учитывает доставленные и отменённые заказы', async () => {
    await insertOrder(pool, { restaurantId: restaurant.id, courierId: courier.id, status: 'delivered' });
    await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'cancelled',
      cancelReason: 'клиент отказался',
    });
    await makeReadyOrder(courier.id);

    const next = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'preparing',
    });

    const order = await service.changeStatus(next.id, { status: 'ready' }, next.version, actor());
    expect(order.status).toBe('ready');
  });

  it('не проверяет лимит, пока заказ не вышел в доставку', async () => {
    await makeReadyOrder(courier.id);
    await makeReadyOrder(courier.id);
    await makeReadyOrder(courier.id);

    const order = await createOrder();
    const assigned = await service.assignCourier(order.id, courier.id, order.version, actor());

    expect(assigned.courier?.name).toBe('Иван');
  });

  it('отклоняет замену курьера на перегруженного для заказа в ready', async () => {
    const busy = await insertCourier(pool, { name: 'Загруженный' });
    await makeReadyOrder(busy.id);
    await makeReadyOrder(busy.id);
    await makeReadyOrder(busy.id);

    const ready = await makeReadyOrder(courier.id);
    const error = await captureError(() =>
      service.assignCourier(ready.id, busy.id, ready.version, actor()),
    );

    expect(error.code).toBe('COURIER_CAPACITY_EXCEEDED');
    expect(error.details).toMatchObject({ courierName: 'Загруженный' });
  });
});

describe('отмена заказа', () => {
  it('отменяет заказ с указанием причины', async () => {
    const created = await createOrder();
    const order = await service.cancel(
      created.id,
      { reason: 'клиент передумал' },
      created.version,
      actor('Анна'),
    );

    expect(order).toMatchObject({ status: 'cancelled', cancelReason: 'клиент передумал' });

    const audit = await service.getAudit(order.id, { order: 'desc', page: 1, pageSize: 10 });
    expect(audit.items[0]).toMatchObject({
      action: 'ORDER_CANCELLED',
      oldStatus: 'new',
      newStatus: 'cancelled',
      comment: 'клиент передумал',
    });
  });

  it('отменяет заказ в статусе ready', async () => {
    const ready = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'ready',
    });

    const order = await service.cancel(ready.id, { reason: 'ресторан закрылся' }, ready.version, actor());
    expect(order.status).toBe('cancelled');
  });

  it('запрещает отмену после передачи курьеру — граница из ТЗ', async () => {
    const pickedUp = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'picked_up',
    });

    const error = await captureError(() =>
      service.cancel(pickedUp.id, { reason: 'поздно' }, pickedUp.version, actor()),
    );

    expect(error.code).toBe('ORDER_NOT_CANCELLABLE');
    expect(error.httpStatus).toBe(409);
  });

  it('запрещает повторную отмену', async () => {
    const created = await createOrder();
    const cancelled = await service.cancel(created.id, { reason: 'причина' }, created.version, actor());

    const error = await captureError(() =>
      service.cancel(cancelled.id, { reason: 'ещё раз' }, cancelled.version, actor()),
    );
    expect(error.code).toBe('ORDER_TERMINAL');
  });

  it('освобождает слот курьера после отмены', async () => {
    await insertOrder(pool, { restaurantId: restaurant.id, courierId: courier.id, status: 'ready' });
    await insertOrder(pool, { restaurantId: restaurant.id, courierId: courier.id, status: 'ready' });
    const third = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'ready',
    });

    await service.cancel(third.id, { reason: 'клиент отменил' }, third.version, actor());

    const next = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'preparing',
    });
    const order = await service.changeStatus(next.id, { status: 'ready' }, next.version, actor());

    expect(order.status).toBe('ready');
  });
});

describe('чтение несуществующего заказа', () => {
  const missing = '00000000-0000-4000-8000-000000000000';

  it('getById отдаёт ORDER_NOT_FOUND', async () => {
    const error = await captureError(() => service.getById(missing));
    expect(error.code).toBe('ORDER_NOT_FOUND');
    expect(error.httpStatus).toBe(404);
  });

  it('getAudit отдаёт ORDER_NOT_FOUND, а не пустой список', async () => {
    const error = await captureError(() =>
      service.getAudit(missing, { order: 'desc', page: 1, pageSize: 10 }),
    );
    expect(error.code).toBe('ORDER_NOT_FOUND');
  });
});
