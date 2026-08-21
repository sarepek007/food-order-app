import { Buffer } from 'node:buffer';
import type { ProblemDetails } from '@food/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DbPool } from '../../src/db/pool.js';
import {
  createTestPool,
  insertCourier,
  insertOrder,
  insertRestaurant,
  truncateAll,
  type SeedCourier,
  type SeedRestaurant,
} from '../helpers/test-db.js';
import { createTestApp } from '../helpers/app.js';
import { TEST_COURIER_LIMIT } from '../helpers/service.js';

const pool: DbPool = createTestPool('http-test');
let app: FastifyInstance;

let restaurant: SeedRestaurant;
let courier: SeedCourier;

const BASE = '/api/v1';

beforeAll(async () => {
  app = await createTestApp(pool);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
  restaurant = await insertRestaurant(pool, { name: 'Пушкин' });
  courier = await insertCourier(pool, { name: 'Иван' });
});

function problemOf(payload: string): ProblemDetails {
  return JSON.parse(payload) as ProblemDetails;
}

async function createOrder(): Promise<{ id: string; version: number; etag: string }> {
  const response = await app.inject({
    method: 'POST',
    url: `${BASE}/orders`,
    headers: { 'x-actor': 'оператор Анна' },
    payload: {
      customerName: 'Пётр Клиентов',
      restaurantId: restaurant.id,
      deliveryAddress: 'ул. Ленина, д. 5',
      totalAmount: '1290.50',
    },
  });

  expect(response.statusCode).toBe(201);
  const body = response.json<{ id: string; version: number }>();
  return { id: body.id, version: body.version, etag: response.headers['etag'] as string };
}

describe('GET /orders', () => {
  it('отдаёт список с метаданными пагинации', async () => {
    await insertOrder(pool, { restaurantId: restaurant.id });
    const response = await app.inject({ method: 'GET', url: `${BASE}/orders` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
  });

  it('отдаёт пустой список, а не 404, когда заказов нет', async () => {
    const response = await app.inject({ method: 'GET', url: `${BASE}/orders?status=delivered` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [], total: 0 });
  });

  it('пробрасывает фильтры в выборку', async () => {
    await insertOrder(pool, { restaurantId: restaurant.id, status: 'new' });
    await insertOrder(pool, { restaurantId: restaurant.id, status: 'accepted' });

    const response = await app.inject({ method: 'GET', url: `${BASE}/orders?status=accepted` });
    expect(response.json<{ total: number }>().total).toBe(1);
  });

  it('отклоняет неизвестный статус с разбором по полям', async () => {
    const response = await app.inject({ method: 'GET', url: `${BASE}/orders?status=shipped` });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const problem = problemOf(response.payload);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.details).toMatchObject({ issues: [{ path: expect.stringContaining('status') }] });
  });

  it('отклоняет сортировку по полю вне белого списка', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${BASE}/orders?sort=total_amount%3B%20DROP%20TABLE%20orders`,
    });
    expect(response.statusCode).toBe(400);
  });

  it('отклоняет слишком большой размер страницы', async () => {
    const response = await app.inject({ method: 'GET', url: `${BASE}/orders?pageSize=1000` });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /orders/:id', () => {
  it('возвращает карточку и ETag с версией', async () => {
    const created = await createOrder();
    const response = await app.inject({ method: 'GET', url: `${BASE}/orders/${created.id}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['etag']).toBe('"1"');
    expect(response.json()).toMatchObject({
      id: created.id,
      status: 'new',
      version: 1,
      allowedTransitions: ['accepted', 'cancelled'],
      cancellable: true,
    });
  });

  it('на несуществующий заказ отвечает 404 в формате problem+json', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${BASE}/orders/00000000-0000-4000-8000-000000000000`,
    });

    expect(response.statusCode).toBe(404);
    const problem = problemOf(response.payload);
    expect(problem).toMatchObject({ code: 'ORDER_NOT_FOUND', status: 404 });
    expect(problem.type).toContain('order-not-found');
  });

  it('на некорректный uuid отвечает 400, а не 404', async () => {
    const response = await app.inject({ method: 'GET', url: `${BASE}/orders/не-uuid` });
    expect(response.statusCode).toBe(400);
    expect(problemOf(response.payload).code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /orders', () => {
  it('создаёт заказ и отдаёт 201 с Location', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/orders`,
      payload: {
        customerName: 'Пётр',
        restaurantId: restaurant.id,
        deliveryAddress: 'ул. Ленина, д. 5',
        totalAmount: '100.00',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers['location']).toContain('/api/v1/orders/');
    expect(response.headers['etag']).toBe('"1"');
  });

  it('отклоняет некорректное тело с указанием полей', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/orders`,
      payload: { customerName: 'И', restaurantId: 'x', deliveryAddress: 'ул', totalAmount: 'много' },
    });

    expect(response.statusCode).toBe(400);
    const problem = problemOf(response.payload);
    const paths = (problem.details as { issues: { path: string }[] }).issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['customerName', 'restaurantId', 'totalAmount']));
  });

  it('отклоняет некорректный JSON', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/orders`,
      headers: { 'content-type': 'application/json' },
      payload: '{"customerName":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });
});

describe('предусловие If-Match', () => {
  it('без версии отвечает 428 и объясняет причину', async () => {
    const created = await createOrder();
    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      payload: { status: 'accepted' },
    });

    expect(response.statusCode).toBe(428);
    const problem = problemOf(response.payload);
    expect(problem.code).toBe('PRECONDITION_REQUIRED');
    expect(problem.detail).toContain('If-Match');
  });

  it('применяет изменение при корректном If-Match и обновляет ETag', async () => {
    const created = await createOrder();
    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      headers: { 'if-match': created.etag },
      payload: { status: 'accepted' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['etag']).toBe('"2"');
    expect(response.json()).toMatchObject({ status: 'accepted', version: 2 });
  });

  it('принимает слабый валидатор W/"1"', async () => {
    const created = await createOrder();
    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      headers: { 'if-match': 'W/"1"' },
      payload: { status: 'accepted' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('принимает версию в теле как запасной путь', async () => {
    const created = await createOrder();
    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      payload: { status: 'accepted', version: 1 },
    });
    expect(response.statusCode).toBe(200);
  });

  it('отклоняет мусор в If-Match как ошибку запроса', async () => {
    const created = await createOrder();
    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      headers: { 'if-match': 'последняя' },
      payload: { status: 'accepted' },
    });

    expect(response.statusCode).toBe(400);
    expect(problemOf(response.payload).detail).toContain('If-Match');
  });

  it('If-Match: * применяет изменение поверх текущего состояния', async () => {
    const created = await createOrder();
    await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      headers: { 'if-match': created.etag },
      payload: { status: 'accepted' },
    });

    const forced = await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      headers: { 'if-match': '*' },
      payload: { status: 'preparing' },
    });

    expect(forced.statusCode).toBe(200);
    expect(forced.json()).toMatchObject({ status: 'preparing', version: 3 });
  });
});

describe('конфликт версий по HTTP', () => {
  it('устаревший If-Match даёт 409 с актуальным состоянием', async () => {
    const created = await createOrder();

    const first = await app.inject({
      method: 'PUT',
      url: `${BASE}/orders/${created.id}/courier`,
      headers: { 'if-match': created.etag, 'x-actor': 'оператор B' },
      payload: { courierId: courier.id },
    });
    expect(first.statusCode).toBe(200);

    const maria = await insertCourier(pool, { name: 'Мария' });
    const stale = await app.inject({
      method: 'PUT',
      url: `${BASE}/orders/${created.id}/courier`,
      headers: { 'if-match': created.etag, 'x-actor': 'оператор A' },
      payload: { courierId: maria.id },
    });

    expect(stale.statusCode).toBe(409);
    const problem = problemOf(stale.payload);
    expect(problem.code).toBe('ORDER_VERSION_CONFLICT');
    expect(problem.detail).toContain('оператор B');

    const details = problem.details as {
      expectedVersion: number;
      actualVersion: number;
      changes: string[];
      current: { courier: { name: string } };
    };
    expect(details).toMatchObject({ expectedVersion: 1, actualVersion: 2 });
    expect(details.changes).toEqual(['назначен курьер Иван']);
    expect(details.current.courier.name).toBe('Иван');
  });
});

describe('бизнес-ошибки', () => {
  it('недопустимый переход — 409 со списком разрешённых статусов', async () => {
    const created = await createOrder();
    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      headers: { 'if-match': created.etag },
      payload: { status: 'delivered' },
    });

    expect(response.statusCode).toBe(409);
    const problem = problemOf(response.payload);
    expect(problem.code).toBe('ORDER_INVALID_TRANSITION');
    expect(problem.details).toMatchObject({ allowedStatuses: ['accepted', 'cancelled'] });
  });

  it('переход в ready без курьера — 422', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id, status: 'preparing' });
    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      headers: { 'if-match': `"${created.version}"` },
      payload: { status: 'ready' },
    });

    expect(response.statusCode).toBe(422);
    expect(problemOf(response.payload).code).toBe('ORDER_COURIER_REQUIRED');
  });

  it('превышение лимита курьера — 409 с деталями загрузки', async () => {
    for (let index = 0; index < TEST_COURIER_LIMIT; index += 1) {
      await insertOrder(pool, { restaurantId: restaurant.id, courierId: courier.id, status: 'ready' });
    }
    const extra = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'preparing',
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${extra.id}/status`,
      headers: { 'if-match': `"${extra.version}"` },
      payload: { status: 'ready' },
    });

    expect(response.statusCode).toBe(409);
    const problem = problemOf(response.payload);
    expect(problem.code).toBe('COURIER_CAPACITY_EXCEEDED');
    expect(problem.details).toMatchObject({ activeCount: TEST_COURIER_LIMIT, limit: TEST_COURIER_LIMIT });
  });

  it('отмена после передачи курьеру — 409', async () => {
    const order = await insertOrder(pool, {
      restaurantId: restaurant.id,
      courierId: courier.id,
      status: 'picked_up',
    });

    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/orders/${order.id}/cancel`,
      headers: { 'if-match': `"${order.version}"` },
      payload: { reason: 'клиент передумал' },
    });

    expect(response.statusCode).toBe(409);
    expect(problemOf(response.payload).code).toBe('ORDER_NOT_CANCELLABLE');
  });

  it('отмена без причины — 400', async () => {
    const created = await createOrder();
    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/orders/${created.id}/cancel`,
      headers: { 'if-match': created.etag },
      payload: { reason: '' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('курьер и отмена', () => {
  it('назначает и снимает курьера', async () => {
    const created = await createOrder();

    const assigned = await app.inject({
      method: 'PUT',
      url: `${BASE}/orders/${created.id}/courier`,
      headers: { 'if-match': created.etag },
      payload: { courierId: courier.id },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({ courier: { name: 'Иван' } });

    const removed = await app.inject({
      method: 'DELETE',
      url: `${BASE}/orders/${created.id}/courier`,
      headers: { 'if-match': assigned.headers['etag'] as string },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ courier: null });
  });

  it('отменяет заказ с причиной', async () => {
    const created = await createOrder();
    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/orders/${created.id}/cancel`,
      headers: { 'if-match': created.etag },
      payload: { reason: 'клиент передумал' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'cancelled', cancelReason: 'клиент передумал' });
  });
});

describe('журнал изменений', () => {
  it('отдаёт события заказа с автором из X-Actor', async () => {
    const created = await createOrder();
    await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      headers: { 'if-match': created.etag, 'x-actor': 'Мария Операторова' },
      payload: { status: 'accepted' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `${BASE}/orders/${created.id}/audit?order=desc`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { action: string; actor: string }[]; total: number }>();
    expect(body.total).toBe(2);
    expect(body.items[0]).toMatchObject({ action: 'STATUS_CHANGED', actor: 'Мария Операторова' });
    expect(body.items[1]).toMatchObject({ action: 'ORDER_CREATED', actor: 'оператор Анна' });
  });

  it('сохраняет кириллическое имя оператора из сырых UTF-8 байтов заголовка', async () => {
    const created = await createOrder();
    // Именно так значение выглядит после разбора HTTP: заголовки — latin-1.
    const rawHeader = Buffer.from('Анна Петрова', 'utf8').toString('latin1');

    await app.inject({
      method: 'PATCH',
      url: `${BASE}/orders/${created.id}/status`,
      headers: { 'if-match': created.etag, 'x-actor': rawHeader },
      payload: { status: 'accepted' },
    });

    const audit = await app.inject({ method: 'GET', url: `${BASE}/orders/${created.id}/audit` });
    expect(audit.json<{ items: { actor: string }[] }>().items[0]?.actor).toBe('Анна Петрова');
  });

  it('без X-Actor подставляет значение по умолчанию', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${BASE}/orders`,
      payload: {
        customerName: 'Пётр',
        restaurantId: restaurant.id,
        deliveryAddress: 'ул. Ленина, д. 5',
        totalAmount: '100.00',
      },
    });

    const audit = await app.inject({
      method: 'GET',
      url: `${BASE}/orders/${response.json<{ id: string }>().id}/audit`,
    });
    expect(audit.json<{ items: { actor: string }[] }>().items[0]?.actor).toBe('operator');
  });

  it('журнал несуществующего заказа — 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${BASE}/orders/00000000-0000-4000-8000-000000000000/audit`,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('справочники и служебное', () => {
  it('отдаёт рестораны', async () => {
    const response = await app.inject({ method: 'GET', url: `${BASE}/restaurants` });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown[]>()).toHaveLength(1);
  });

  it('отдаёт курьеров с загрузкой и признаком свободного слота', async () => {
    await insertOrder(pool, { restaurantId: restaurant.id, courierId: courier.id, status: 'ready' });

    const response = await app.inject({ method: 'GET', url: `${BASE}/couriers` });
    expect(response.json<unknown[]>()[0]).toMatchObject({
      name: 'Иван',
      activeOrdersCount: 1,
      activeLimit: TEST_COURIER_LIMIT,
      hasCapacity: true,
    });
  });

  it('health отвечает при живой БД', async () => {
    const response = await app.inject({ method: 'GET', url: `${BASE}/health` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('неизвестный маршрут отдаёт problem+json, а не HTML', async () => {
    const response = await app.inject({ method: 'GET', url: `${BASE}/unknown` });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(problemOf(response.payload).title).toBe('Маршрут не найден');
  });

  it('публикует OpenAPI-описание', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);

    const spec = response.json<{ paths: Record<string, unknown>; info: { title: string } }>();
    expect(spec.info.title).toBe('Food Order Ops API');
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/orders', '/orders/{id}', '/orders/{id}/status', '/orders/{id}/courier']),
    );
  });
});
