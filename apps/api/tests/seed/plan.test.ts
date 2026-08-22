import {
  CANCELLABLE_STATUSES,
  ORDER_STATUSES,
  canTransition,
  occupiesCourierSlot,
  requiresCourier,
  type OrderStatus,
} from '@food/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, buildSeedPlan, progressPathTo, type PlannedOrder } from '../../src/seed/plan.js';
import { SeededRandom } from '../../src/seed/random.js';

const NOW = new Date('2026-05-21T12:00:00.000Z');

function plan(overrides = {}) {
  return buildSeedPlan({ now: NOW, ...overrides });
}

describe('SeededRandom', () => {
  it('воспроизводит одну и ту же последовательность для одного зерна', () => {
    const first = Array.from({ length: 20 }, () => new SeededRandom(42).next());
    const second = new SeededRandom(42);
    expect(first[0]).toBe(second.next());

    const a = new SeededRandom(7);
    const b = new SeededRandom(7);
    expect(Array.from({ length: 50 }, () => a.int(0, 1000))).toEqual(
      Array.from({ length: 50 }, () => b.int(0, 1000)),
    );
  });

  it('разные зёрна дают разные последовательности', () => {
    const a = Array.from({ length: 20 }, (_, i) => new SeededRandom(1).int(i, i + 100));
    const b = Array.from({ length: 20 }, (_, i) => new SeededRandom(2).int(i, i + 100));
    expect(a).not.toEqual(b);
  });

  it('держится в заданных границах', () => {
    const random = new SeededRandom(DEFAULT_SEED);
    for (let index = 0; index < 500; index += 1) {
      const value = random.int(5, 9);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(9);
    }
  });

  it('генерирует корректные UUID v4', () => {
    const random = new SeededRandom(DEFAULT_SEED);
    const ids = Array.from({ length: 200 }, () => random.uuid());

    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('форматирует сумму как строку с двумя знаками', () => {
    const random = new SeededRandom(DEFAULT_SEED);
    for (let index = 0; index < 100; index += 1) {
      expect(random.money(300, 8000)).toMatch(/^\d+\.\d{2}$/);
    }
  });
});

describe('progressPathTo', () => {
  it('строит путь по конвейеру', () => {
    expect(progressPathTo('new')).toEqual([]);
    expect(progressPathTo('accepted')).toEqual(['accepted']);
    expect(progressPathTo('ready')).toEqual(['accepted', 'preparing', 'ready']);
    expect(progressPathTo('delivered')).toEqual([
      'accepted',
      'preparing',
      'ready',
      'picked_up',
      'delivered',
    ]);
  });

  it('каждый шаг пути — допустимый переход', () => {
    for (const target of ['accepted', 'preparing', 'ready', 'picked_up', 'delivered'] as OrderStatus[]) {
      let current: OrderStatus = 'new';
      for (const next of progressPathTo(target)) {
        expect(canTransition(current, next)).toBe(true);
        current = next;
      }
      expect(current).toBe(target);
    }
  });
});

describe('детерминированность плана', () => {
  it('одно зерно даёт побайтово одинаковый набор данных', () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });

  it('разные зёрна дают разные данные', () => {
    expect(JSON.stringify(plan({ seed: 1 }))).not.toBe(JSON.stringify(plan({ seed: 2 })));
  });

  it('идентификаторы стабильны между запусками', () => {
    expect(plan().orders[0]?.id).toBe(plan().orders[0]?.id);
  });
});

describe('объём и распределение', () => {
  const generated = plan();

  it('создаёт запрошенное количество сущностей', () => {
    expect(generated.restaurants).toHaveLength(20);
    expect(generated.couriers).toHaveLength(20);
    expect(generated.orders).toHaveLength(200);
  });

  it('покрывает все статусы заказа', () => {
    const present = new Set(generated.orders.map((order) => order.status));
    for (const status of ORDER_STATUSES) {
      expect(present, `нет заказов в статусе ${status}`).toContain(status);
    }
  });

  it('распределяет заказы по всем ресторанам', () => {
    const used = new Set(generated.orders.map((order) => order.restaurantIndex));
    expect(used.size).toBe(generated.restaurants.length);
  });

  it('оставляет заметную долю заказов без курьера', () => {
    const unassigned = generated.orders.filter((order) => order.courierIndex === null).length;
    expect(unassigned).toBeGreaterThanOrEqual(20);
    expect(unassigned).toBeLessThanOrEqual(80);
  });

  it('разносит даты создания по месяцу', () => {
    const times = generated.orders.map((order) => order.createdAt.getTime());
    const span = Math.max(...times) - Math.min(...times);
    expect(span).toBeGreaterThan(20 * 24 * 60 * 60 * 1000);
    expect(Math.max(...times)).toBeLessThanOrEqual(NOW.getTime());
  });

  it('сортирует заказы по дате создания', () => {
    const times = generated.orders.map((order) => order.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('использует разные варианты написания адресов', () => {
    const addresses = generated.orders.map((order) => order.deliveryAddress);
    // Одна улица в разных написаниях — на этом держится демонстрация поиска.
    expect(addresses.some((address) => address.includes('ул. Ленина'))).toBe(true);
    expect(addresses.some((address) => address.includes('улица Ленина'))).toBe(true);
    // Различие ё/е тоже должно встречаться в данных.
    expect(addresses.some((address) => address.includes('Молодёжный'))).toBe(true);
  });

  it('генерирует суммы в разумном диапазоне', () => {
    for (const order of generated.orders) {
      const amount = Number(order.totalAmount);
      expect(amount).toBeGreaterThanOrEqual(300);
      expect(amount).toBeLessThanOrEqual(8000);
    }
  });
});

describe('доменные инварианты плана', () => {
  const generated = plan();

  it('у заказов, требующих исполнителя, курьер назначен', () => {
    for (const order of generated.orders) {
      if (requiresCourier(order.status)) {
        expect(order.courierIndex, `заказ ${order.id} в статусе ${order.status}`).not.toBeNull();
      }
    }
  });

  it('ни один курьер не превышает лимит активных доставок', () => {
    const load = new Map<number, number>();
    for (const order of generated.orders) {
      if (order.courierIndex !== null && occupiesCourierSlot(order.status)) {
        load.set(order.courierIndex, (load.get(order.courierIndex) ?? 0) + 1);
      }
    }
    for (const [courierIndex, count] of load) {
      expect(count, `курьер #${courierIndex}`).toBeLessThanOrEqual(3);
    }
  });

  it('активные заказы не назначены неактивным курьерам', () => {
    for (const order of generated.orders) {
      if (order.courierIndex !== null && occupiesCourierSlot(order.status)) {
        expect(generated.couriers[order.courierIndex]?.isActive).toBe(true);
      }
    }
  });

  it('у отменённых заказов есть причина, у остальных её нет', () => {
    for (const order of generated.orders) {
      if (order.status === 'cancelled') {
        expect(order.cancelReason).toBeTruthy();
      } else {
        expect(order.cancelReason).toBeNull();
      }
    }
  });

  it('отмена происходит только из статусов, где она разрешена', () => {
    for (const order of generated.orders) {
      if (order.status !== 'cancelled') continue;
      const cancelEvent = order.events.find((event) => event.action === 'ORDER_CANCELLED');
      expect(cancelEvent).toBeDefined();
      expect(CANCELLABLE_STATUSES).toContain(cancelEvent!.oldStatus as OrderStatus);
    }
  });

  it('есть хотя бы один неактивный курьер — для проверки COURIER_INACTIVE', () => {
    expect(generated.couriers.some((courier) => !courier.isActive)).toBe(true);
  });
});

describe('журнал изменений в плане', () => {
  const generated = plan();

  function checkOrder(order: PlannedOrder): void {
    expect(order.events[0]?.action).toBe('ORDER_CREATED');
    expect(order.events[0]?.at.getTime()).toBe(order.createdAt.getTime());

    // Каждое событие после создания увеличивает версию ровно на единицу.
    order.events.forEach((event, index) => {
      expect(event.orderVersion).toBe(index + 1);
    });
    expect(order.version).toBe(order.events.length);

    // Время строго возрастает.
    for (let index = 1; index < order.events.length; index += 1) {
      expect(order.events[index]!.at.getTime()).toBeGreaterThan(order.events[index - 1]!.at.getTime());
    }

    // Последнее событие совпадает с updated_at заказа.
    expect(order.updatedAt.getTime()).toBe(order.events.at(-1)!.at.getTime());

    // Цепочка статусов непрерывна и состоит из допустимых переходов.
    let current: OrderStatus = 'new';
    for (const event of order.events) {
      if (event.action !== 'STATUS_CHANGED' && event.action !== 'ORDER_CANCELLED') continue;
      expect(event.oldStatus).toBe(current);
      expect(canTransition(current, event.newStatus!)).toBe(true);
      current = event.newStatus!;
    }
    expect(current).toBe(order.status);
  }

  it('журнал каждого заказа согласован с его состоянием', () => {
    for (const order of generated.orders) {
      checkOrder(order);
    }
  });

  it('назначение курьера происходит до выхода заказа в доставку', () => {
    for (const order of generated.orders) {
      const assignIndex = order.events.findIndex((event) => event.action === 'COURIER_ASSIGNED');
      const readyIndex = order.events.findIndex((event) => event.newStatus === 'ready');
      if (assignIndex === -1 || readyIndex === -1) continue;
      expect(assignIndex).toBeLessThan(readyIndex);
    }
  });

  it('курьер в журнале совпадает с курьером заказа', () => {
    for (const order of generated.orders) {
      const lastAssignment = [...order.events].reverse().find((event) => event.newCourierIndex !== null);
      expect(lastAssignment?.newCourierIndex ?? null).toBe(order.courierIndex);
    }
  });

  it('журнал содержит записи от разных операторов', () => {
    const actors = new Set(generated.orders.flatMap((order) => order.events.map((event) => event.actor)));
    expect(actors.size).toBeGreaterThan(2);
  });
});

describe('устойчивость к параметрам', () => {
  it('масштабируется на меньший объём', () => {
    const small = plan({ orders: 10, restaurants: 3, couriers: 2 });
    expect(small.orders).toHaveLength(10);
    expect(small.restaurants).toHaveLength(3);
  });

  it('соблюдает лимит курьера при нехватке исполнителей', () => {
    const tight = buildSeedPlan({ now: NOW, orders: 100, couriers: 2, courierActiveLimit: 3 });
    const load = new Map<number, number>();
    for (const order of tight.orders) {
      if (order.courierIndex !== null && occupiesCourierSlot(order.status)) {
        load.set(order.courierIndex, (load.get(order.courierIndex) ?? 0) + 1);
      }
    }
    for (const count of load.values()) {
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it('отказывается генерировать больше данных, чем есть в справочниках', () => {
    expect(() => buildSeedPlan({ restaurants: 500 })).toThrow(/справочных данных/);
  });
});
