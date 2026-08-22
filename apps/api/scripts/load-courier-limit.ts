/**
 * Нагрузочная проверка лимита активных доставок.
 *
 * Интеграционный тест гоняет пять параллельных назначений; здесь их сотни —
 * нужно убедиться, что advisory-лок не только корректен, но и переживает
 * нагрузку: лимит не превышается, а время ожидания не разъезжается.
 *
 * Запуск (сервис должен быть поднят):
 *   pnpm --filter @food/api load:courier -- --orders 200 --concurrency 50
 */
import process from 'node:process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000/api/v1' },
    orders: { type: 'string', default: '200' },
    concurrency: { type: 'string', default: '50' },
    limit: { type: 'string', default: '3' },
  },
  // pnpm пробрасывает разделитель «--» как позиционный аргумент.
  allowPositionals: true,
});

const baseUrl = values.url!;
const totalOrders = Number(values.orders);
const concurrency = Number(values.concurrency);
const courierLimit = Number(values.limit);

const log = (message: string): void => {
  // eslint-disable-next-line no-console
  console.log(message);
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

interface Ref {
  id: string;
  name: string;
}

interface CourierRef extends Ref {
  isActive: boolean;
  hasCapacity: boolean;
  activeOrdersCount: number;
}

/** Выполняет задачи пачками заданной ширины. */
async function inBatches<T, R>(items: T[], width: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += width) {
    results.push(...(await Promise.all(items.slice(index, index + width).map(task))));
  }
  return results;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]!;
}

async function main(): Promise<void> {
  const restaurants = await json<Ref[]>('/restaurants');
  const couriers = await json<CourierRef[]>('/couriers');
  const restaurant = restaurants[0];

  // Берём наименее загруженного курьера: часть слотов может быть занята
  // данными seed, и ожидаемое число успехов надо считать от текущей загрузки.
  const courier = couriers
    .filter((item) => item.isActive)
    .sort((left, right) => left.activeOrdersCount - right.activeOrdersCount)[0];

  if (!restaurant || !courier) {
    throw new Error('нет данных: выполните seed');
  }

  const freeSlots = Math.max(0, courierLimit - courier.activeOrdersCount);
  log(
    `Курьер ${courier.name}: занято ${courier.activeOrdersCount}/${courierLimit}, ` +
      `свободно слотов ${freeSlots}`,
  );

  if (freeSlots === 0) {
    throw new Error('у всех курьеров заняты слоты: выполните seed заново');
  }

  log(`Готовим ${totalOrders} заказов на курьера ${courier.name}…`);

  // Заказы доводятся до preparing с назначенным курьером: следующий шаг —
  // переход в ready, который и упирается в лимит.
  const prepared = await inBatches(
    Array.from({ length: totalOrders }, (_, index) => index),
    concurrency,
    async (index) => {
      const created = await json<{ id: string; version: number }>('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Actor': 'load-test' },
        body: JSON.stringify({
          customerName: `Нагрузка ${index}`,
          restaurantId: restaurant.id,
          deliveryAddress: `ул. Нагрузочная, д. ${index}`,
          totalAmount: '100.00',
        }),
      });

      let version = created.version;
      for (const status of ['accepted', 'preparing'] as const) {
        const next = await json<{ version: number }>(`/orders/${created.id}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': `"${version}"`,
            'X-Actor': 'load-test',
          },
          body: JSON.stringify({ status }),
        });
        version = next.version;
      }

      const assigned = await json<{ version: number }>(`/orders/${created.id}/courier`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${version}"`,
          'X-Actor': 'load-test',
        },
        body: JSON.stringify({ courierId: courier.id }),
      });

      return { id: created.id, version: assigned.version };
    },
  );

  log(`Одновременный перевод в ready: ${prepared.length} запросов…`);

  const started = Date.now();
  const outcomes = await Promise.all(
    prepared.map(async (order) => {
      const requestStarted = Date.now();
      const response = await fetch(`${baseUrl}/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${order.version}"`,
          'X-Actor': 'load-test',
        },
        body: JSON.stringify({ status: 'ready' }),
      });

      const durationMs = Date.now() - requestStarted;
      const body = (await response.json()) as { code?: string };
      return { status: response.status, code: body.code, durationMs };
    }),
  );

  const totalMs = Date.now() - started;
  const accepted = outcomes.filter((item) => item.status === 200);
  const rejected = outcomes.filter((item) => item.status !== 200);
  const byCode = new Map<string, number>();
  for (const item of rejected) {
    byCode.set(item.code ?? String(item.status), (byCode.get(item.code ?? String(item.status)) ?? 0) + 1);
  }

  const durations = outcomes.map((item) => item.durationMs);

  log('');
  log(`Всего запросов:        ${outcomes.length}`);
  log(`Применено:             ${accepted.length}`);
  log(`Отклонено:             ${rejected.length}`);
  for (const [code, count] of byCode) {
    log(`  ${code}: ${count}`);
  }
  log(`Общее время:           ${totalMs} мс`);
  log(`Задержка p50 / p95 / max: ${percentile(durations, 50)} / ${percentile(durations, 95)} / ${Math.max(...durations)} мс`);

  const active = await json<{ total: number }>(
    `/orders?status=ready,picked_up&courierId=${courier.id}&pageSize=1`,
  );
  log(`Активных заказов у курьера: ${active.total} (лимит ${courierLimit})`);

  const expected = Math.min(freeSlots, outcomes.length);

  if (active.total > courierLimit) {
    log('');
    log('ЛИМИТ НАРУШЕН — блокировка не выдержала нагрузку');
    process.exitCode = 1;
  } else if (accepted.length !== expected) {
    log('');
    log(`Ожидалось ровно ${expected} успешных назначений, получено ${accepted.length}`);
    process.exitCode = 1;
  } else {
    log('');
    log(`Лимит соблюдён под нагрузкой: применено ${accepted.length} из ${outcomes.length}`);
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
