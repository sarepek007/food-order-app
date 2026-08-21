import { listOrdersQuerySchema } from '@food/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbPool } from '../../src/db/pool.js';
import type { OrderService } from '../../src/services/order-service.js';
import {
  createTestPool,
  insertCourier,
  insertOrder,
  insertRestaurant,
  truncateAll,
} from '../helpers/test-db.js';
import { createTestService } from '../helpers/service.js';

const pool: DbPool = createTestPool('list-test');
const service: OrderService = createTestService(pool);

/**
 * Запрос собирается через реальную схему: тест заодно проверяет разбор
 * query-параметров. Вход намеренно нетипизирован — из HTTP всё приходит строками.
 */
function query(input: Record<string, unknown> = {}) {
  return listOrdersQuerySchema.parse(input);
}

const fixture = {
  pushkin: '',
  mario: '',
  ivan: '',
  maria: '',
};

afterAll(async () => {
  await pool.end();
});

beforeAll(async () => {
  await truncateAll(pool);

  const pushkin = await insertRestaurant(pool, { name: 'Пушкин' });
  const mario = await insertRestaurant(pool, { name: 'Марио' });
  const ivan = await insertCourier(pool, { name: 'Иван' });
  const maria = await insertCourier(pool, { name: 'Мария' });

  fixture.pushkin = pushkin.id;
  fixture.mario = mario.id;
  fixture.ivan = ivan.id;
  fixture.maria = maria.id;

  const day = (offset: number) => new Date(Date.UTC(2026, 4, offset, 12, 0, 0));

  await insertOrder(pool, {
    restaurantId: pushkin.id,
    status: 'new',
    deliveryAddress: 'Ленинский проспект, д. 12',
    totalAmount: '500.00',
    createdAt: day(1),
  });
  await insertOrder(pool, {
    restaurantId: pushkin.id,
    courierId: ivan.id,
    status: 'preparing',
    deliveryAddress: 'ул. Ленина, д. 5, кв. 3',
    totalAmount: '1500.00',
    createdAt: day(2),
  });
  await insertOrder(pool, {
    restaurantId: mario.id,
    courierId: ivan.id,
    status: 'ready',
    deliveryAddress: 'пр-т Королёва, д. 12',
    totalAmount: '2500.00',
    createdAt: day(3),
  });
  await insertOrder(pool, {
    restaurantId: mario.id,
    courierId: maria.id,
    status: 'delivered',
    deliveryAddress: 'наб. реки Фонтанки, 21',
    totalAmount: '300.00',
    createdAt: day(4),
  });
  await insertOrder(pool, {
    restaurantId: mario.id,
    status: 'cancelled',
    cancelReason: 'клиент передумал',
    deliveryAddress: 'Тверская улица, 7',
    totalAmount: '4500.00',
    createdAt: day(5),
  });
});

describe('фильтрация', () => {
  it('без фильтров отдаёт все заказы', async () => {
    const page = await service.list(query());
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(5);
  });

  it('фильтрует по одному статусу', async () => {
    const page = await service.list(query({ status: 'ready' }));
    expect(page.total).toBe(1);
    expect(page.items[0]?.status).toBe('ready');
  });

  it('фильтрует по нескольким статусам', async () => {
    const page = await service.list(query({ status: 'new,preparing' }));
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.status).sort()).toEqual(['new', 'preparing']);
  });

  it('фильтрует по ресторану', async () => {
    const page = await service.list(query({ restaurantId: fixture.mario }));
    expect(page.total).toBe(3);
    expect(page.items.every((item) => item.restaurant.name === 'Марио')).toBe(true);
  });

  it('фильтрует по курьеру', async () => {
    const page = await service.list(query({ courierId: fixture.ivan }));
    expect(page.total).toBe(2);
    expect(page.items.every((item) => item.courier?.name === 'Иван')).toBe(true);
  });

  it('находит заказы без курьера', async () => {
    const page = await service.list(query({ unassigned: 'true' }));
    expect(page.total).toBe(2);
    expect(page.items.every((item) => item.courier === null)).toBe(true);
  });

  it('фильтрует по диапазону суммы', async () => {
    const page = await service.list(query({ minAmount: '500', maxAmount: '2500' }));
    expect(page.total).toBe(3);
    expect(page.items.every((item) => Number(item.totalAmount) >= 500)).toBe(true);
  });

  it('фильтрует по диапазону дат создания', async () => {
    const page = await service.list(
      query({ createdFrom: '2026-05-03T00:00:00.000Z', createdTo: '2026-05-04T23:59:59.000Z' }),
    );
    expect(page.total).toBe(2);
  });

  it('комбинирует фильтры по И', async () => {
    const page = await service.list(query({ restaurantId: fixture.mario, status: 'ready' }));
    expect(page.total).toBe(1);
  });

  it('на пустой выборке возвращает корректную пагинацию', async () => {
    const page = await service.list(query({ status: 'picked_up' }));
    expect(page).toMatchObject({ items: [], total: 0, totalPages: 0, page: 1 });
  });
});

describe('сортировка', () => {
  it('по умолчанию — новые сверху', async () => {
    const page = await service.list(query());
    const dates = page.items.map((item) => item.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('поддерживает обратный порядок по дате', async () => {
    const page = await service.list(query({ sort: 'createdAt', order: 'asc' }));
    expect(page.items[0]?.deliveryAddress).toContain('Ленинский проспект');
  });

  it('сортирует по сумме численно, а не лексикографически', async () => {
    const page = await service.list(query({ sort: 'totalAmount', order: 'asc' }));
    const amounts = page.items.map((item) => Number(item.totalAmount));
    expect(amounts).toEqual([300, 500, 1500, 2500, 4500]);
  });

  it('сортирует по статусу в порядке жизненного цикла', async () => {
    const page = await service.list(query({ sort: 'status', order: 'asc' }));
    expect(page.items.map((item) => item.status)).toEqual([
      'new',
      'preparing',
      'ready',
      'delivered',
      'cancelled',
    ]);
  });
});

describe('пагинация', () => {
  it('разбивает выборку на страницы', async () => {
    const first = await service.list(query({ page: '1', pageSize: '2' }));
    const second = await service.list(query({ page: '2', pageSize: '2' }));

    expect(first).toMatchObject({ total: 5, totalPages: 3, pageSize: 2 });
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);

    const ids = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(ids.size).toBe(4);
  });

  it('за последней страницей отдаёт пустой список, а не ошибку', async () => {
    const page = await service.list(query({ page: '99', pageSize: '10' }));
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(5);
  });

  it('total не зависит от размера страницы', async () => {
    const small = await service.list(query({ pageSize: '1' }));
    const large = await service.list(query({ pageSize: '100' }));
    expect(small.total).toBe(large.total);
  });
});

describe('поиск по адресу', () => {
  async function search(q: string) {
    const page = await service.list(query({ q }));
    return page.items.map((item) => item.deliveryAddress);
  }

  it('находит по точному фрагменту', async () => {
    expect(await search('Тверская')).toEqual(['Тверская улица, 7']);
  });

  it('находит по адресу с опечатками', async () => {
    expect(await search('Лениский проспкт 12')).toContain('Ленинский проспект, д. 12');
  });

  it('игнорирует различие ё и е', async () => {
    expect(await search('Королева')).toEqual(['пр-т Королёва, д. 12']);
  });

  it('игнорирует регистр и пунктуацию', async () => {
    expect(await search('ФОНТАНКИ,')).toEqual(['наб. реки Фонтанки, 21']);
  });

  it('находит по короткому числовому фрагменту', async () => {
    expect(await search('21')).toContain('наб. реки Фонтанки, 21');
  });

  // Порог отсекает совпадения по общим токенам вроде «проспект» и «-ский»:
  // измеренные оценки лежат ниже 0.45, полезные — выше 0.57 (ADR 0005).
  it.each([
    'Владивосток Океанский проспект',
    'Мурманск Кольский проспект 8',
  ])('не находит чужой адрес «%s»', async (q) => {
    expect(await search(q)).toEqual([]);
  });

  it('комбинируется с фильтром по статусу', async () => {
    const page = await service.list(query({ q: 'Ленин', status: 'preparing' }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.deliveryAddress).toContain('ул. Ленина');
  });

  it('сортировка по релевантности ставит точное совпадение первым', async () => {
    const page = await service.list(query({ q: 'Ленинский проспект 12', sort: 'relevance' }));
    expect(page.items[0]?.deliveryAddress).toBe('Ленинский проспект, д. 12');
  });

  it('релевантность без запроса не ломает выдачу', async () => {
    const page = await service.list(query({ sort: 'relevance' }));
    expect(page.total).toBe(5);
  });
});
