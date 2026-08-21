import process from 'node:process';
import { parseArgs } from 'node:util';
import { getConfig } from '../config.js';
import { createPoolFromConfig } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { DEFAULT_SEED } from './plan.js';
import { runSeed } from './seed.js';

const { values } = parseArgs({
  options: {
    seed: { type: 'string' },
    orders: { type: 'string' },
    keep: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  // eslint-disable-next-line no-console
  console.log(`Загрузка демонстрационных данных.

  --seed <число>    зерно генератора (по умолчанию ${DEFAULT_SEED})
  --orders <число>  количество заказов (по умолчанию 200)
  --keep            не очищать таблицы перед загрузкой
`);
  process.exit(0);
}

const config = getConfig();
const pool = createPoolFromConfig(config);
const log = (message: string): void => {
  // eslint-disable-next-line no-console
  console.log(`[seed] ${message}`);
};

try {
  await runMigrations(pool);

  const summary = await runSeed(pool, {
    seed: values.seed ? Number(values.seed) : undefined,
    orders: values.orders ? Number(values.orders) : undefined,
    courierActiveLimit: config.COURIER_ACTIVE_LIMIT,
    reset: !values.keep,
  });

  log(`рестораны: ${summary.restaurants}, курьеры: ${summary.couriers}, заказы: ${summary.orders}`);
  log(`записей в журнале: ${summary.auditEntries}`);
  log(`без курьера: ${summary.unassignedOrders}, максимум активных на курьера: ${summary.maxCourierLoad}`);
  log(
    'статусы: ' +
      Object.entries(summary.statusBreakdown)
        .sort(([, left], [, right]) => right - left)
        .map(([status, count]) => `${status}=${count}`)
        .join(', '),
  );
  log(`готово за ${summary.durationMs} мс`);
} catch (error) {
  console.error(`[seed] ошибка: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
