import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { DbPool } from '../../src/db/pool.js';
import { OrderEvents, type OrderChangedEvent } from '../../src/realtime/order-events.js';
import {
  createTestPool,
  insertCourier,
  insertOrder,
  insertRestaurant,
  testDatabaseUrl,
  truncateAll,
  type SeedRestaurant,
} from '../helpers/test-db.js';
import { TEST_COURIER_LIMIT, actor, createTestService } from '../helpers/service.js';

const pool: DbPool = createTestPool('realtime-test');
const service = createTestService(pool);

let events: OrderEvents;
let restaurant: SeedRestaurant;

/** Ждём события, удовлетворяющего условию, иначе падаем по таймауту. */
function nextEvent(
  source: OrderEvents,
  predicate: (event: OrderChangedEvent) => boolean = () => true,
  timeoutMs = 5_000,
): Promise<OrderChangedEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      source.off('order-changed', handler);
      reject(new Error('уведомление не пришло за отведённое время'));
    }, timeoutMs);

    function handler(event: OrderChangedEvent): void {
      if (!predicate(event)) return;
      clearTimeout(timer);
      source.off('order-changed', handler);
      resolve(event);
    }

    source.on('order-changed', handler);
  });
}

beforeAll(async () => {
  events = new OrderEvents({ connectionString: testDatabaseUrl() });
  await events.start();
});

afterAll(async () => {
  await events.stop();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE idempotency_keys');
  await truncateAll(pool);
  restaurant = await insertRestaurant(pool);
});

describe('публикация изменений', () => {
  it('подписка устанавливается при старте', () => {
    expect(events.connected).toBe(true);
  });

  it('смена статуса доходит до подписчика', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const received = nextEvent(events, (event) => event.orderId === created.id);

    await service.changeStatus(created.id, { status: 'accepted' }, created.version, actor('Анна'));

    expect(await received).toMatchObject({
      orderId: created.id,
      action: 'STATUS_CHANGED',
      oldStatus: 'new',
      newStatus: 'accepted',
      version: 2,
      actor: 'Анна',
    });
  });

  it('назначение курьера доходит до подписчика', async () => {
    const courier = await insertCourier(pool);
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const received = nextEvent(events, (event) => event.action === 'COURIER_ASSIGNED');

    await service.assignCourier(created.id, courier.id, created.version, actor());

    expect((await received).orderId).toBe(created.id);
  });

  it('создание заказа публикуется тоже', async () => {
    const received = nextEvent(events, (event) => event.action === 'ORDER_CREATED');

    const order = await service.create(
      {
        customerName: 'Пётр Клиентов',
        restaurantId: restaurant.id,
        deliveryAddress: 'ул. Ленина, д. 5',
        totalAmount: '100.00',
        currency: 'RUB',
      },
      actor(),
    );

    expect((await received).orderId).toBe(order.id);
  });

  it('отклонённая операция не публикует событие', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });

    const seen: OrderChangedEvent[] = [];
    const collect = (event: OrderChangedEvent): void => {
      seen.push(event);
    };
    events.on('order-changed', collect);

    // Недопустимый переход: транзакция откатывается, NOTIFY не уходит.
    await service
      .changeStatus(created.id, { status: 'delivered' }, created.version, actor())
      .catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 300));
    events.off('order-changed', collect);

    expect(seen).toHaveLength(0);
  });
});

describe('поток Server-Sent Events', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testDatabaseUrl(),
      COURIER_ACTIVE_LIMIT: String(TEST_COURIER_LIMIT),
    });

    app = await buildApp({ config, pool, events });
    // Настоящий сокет: inject() буферизует ответ и для потока не годится.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    baseUrl = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  });

  afterAll(async () => {
    await app.close();
  });

  interface SseClient {
    waitFor: (eventName: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
    close: () => Promise<void>;
    response: Response;
  }

  /**
   * Клиент SSE с одним постоянным читателем на соединение.
   *
   * Брать getReader() на каждое ожидание нельзя: поток блокируется первым
   * читателем, а его отмена закрывает соединение целиком.
   */
  async function openStream(path: string): Promise<SseClient> {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const pending: { event: string; data: Record<string, unknown> }[] = [];
    let buffer = '';

    function drain(): void {
      const frames = buffer.split('\n\n');
      // Последний фрагмент может быть неполным — оставляем его в буфере.
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const eventLine = frame.split('\n').find((line) => line.startsWith('event: '));
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        if (!eventLine || !dataLine) continue;
        pending.push({
          event: eventLine.slice(7).trim(),
          data: JSON.parse(dataLine.slice(6)) as Record<string, unknown>,
        });
      }
    }

    return {
      response,
      async waitFor(eventName: string, timeoutMs = 5_000): Promise<Record<string, unknown>> {
        const deadline = Date.now() + timeoutMs;

        for (;;) {
          const index = pending.findIndex((item) => item.event === eventName);
          if (index >= 0) {
            return pending.splice(index, 1)[0]!.data;
          }
          if (Date.now() > deadline) {
            throw new Error(`событие ${eventName} не пришло за отведённое время`);
          }

          const { value, done } = await reader.read();
          if (done) {
            throw new Error('поток закрыт сервером');
          }
          buffer += decoder.decode(value, { stream: true });
          drain();
        }
      },
      async close(): Promise<void> {
        controller.abort();
        await reader.cancel().catch(() => undefined);
      },
    };
  }

  it('отдаёт корректные заголовки потока', async () => {
    const stream = await openStream('/api/v1/orders/stream');

    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.response.headers.get('cache-control')).toContain('no-cache');
    // Без этого nginx буферизует поток.
    expect(stream.response.headers.get('x-accel-buffering')).toBe('no');

    await stream.close();
  });

  it('сразу подтверждает подписку', async () => {
    const stream = await openStream('/api/v1/orders/stream');

    expect(await stream.waitFor('ready')).toEqual({ watched: 'all' });

    await stream.close();
  });

  it('доставляет изменение заказа подписчику', async () => {
    const created = await insertOrder(pool, { restaurantId: restaurant.id });
    const stream = await openStream('/api/v1/orders/stream');
    await stream.waitFor('ready');

    await service.changeStatus(created.id, { status: 'accepted' }, created.version, actor('Борис'));

    expect(await stream.waitFor('order-changed')).toMatchObject({
      orderId: created.id,
      newStatus: 'accepted',
      actor: 'Борис',
    });

    await stream.close();
  });

  it('фильтрует поток по конкретному заказу', async () => {
    const watched = await insertOrder(pool, { restaurantId: restaurant.id });
    const other = await insertOrder(pool, { restaurantId: restaurant.id });

    const stream = await openStream(`/api/v1/orders/stream?orderId=${watched.id}`);
    expect(await stream.waitFor('ready')).toEqual({ watched: [watched.id] });

    // Чужой заказ меняется первым — его событие не должно попасть в поток.
    await service.changeStatus(other.id, { status: 'accepted' }, other.version, actor());
    await service.changeStatus(watched.id, { status: 'accepted' }, watched.version, actor());

    expect((await stream.waitFor('order-changed')).orderId).toBe(watched.id);

    await stream.close();
  });

  it('отклоняет некорректный идентификатор в фильтре', async () => {
    const response = await fetch(`${baseUrl}/api/v1/orders/stream?orderId=не-uuid`);
    expect(response.status).toBe(400);
    await response.body?.cancel();
  });
});
