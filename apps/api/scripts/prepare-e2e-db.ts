/**
 * Подготовка отдельной базы для e2e.
 *
 * Сценарии e2e создают и меняют заказы — они не должны делать это в базе,
 * которую показывает демонстрационный стенд. Иначе после каждого прогона
 * в списке остаются заказы вида «E2E Клиент 1787393113620».
 *
 * Запуск: pnpm --filter @food/api prepare:e2e-db
 */
import process from 'node:process';
import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { runSeed } from '../src/seed/seed.js';

const target = process.env['E2E_DATABASE_URL'] ?? 'postgres://food:food@localhost:5432/food_orders_e2e';

const log = (message: string): void => {
  // eslint-disable-next-line no-console
  console.log(`[e2e-db] ${message}`);
};

/** CREATE DATABASE не поддерживает IF NOT EXISTS — проверяем наличие вручную. */
async function ensureDatabaseExists(url: string): Promise<void> {
  const parsed = new URL(url);
  const databaseName = parsed.pathname.slice(1);

  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';

  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();

  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);

    if (rowCount === 0) {
      // Имя приходит из конфигурации, не из пользовательского ввода,
      // но идентификатор всё равно экранируем.
      await client.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
      log(`создана база ${databaseName}`);
    } else {
      log(`база ${databaseName} уже существует`);
    }
  } finally {
    await client.end();
  }
}

await ensureDatabaseExists(target);

const pool = createPool({ connectionString: target, applicationName: 'food-order-e2e-setup' });

try {
  const migrations = await runMigrations(pool);
  log(`миграции: применено ${migrations.applied.length}, пропущено ${migrations.skipped.length}`);

  const summary = await runSeed(pool, { reset: true });
  log(`данные: ${summary.restaurants} ресторанов, ${summary.couriers} курьеров, ${summary.orders} заказов`);
} catch (error) {
  console.error(`[e2e-db] ошибка: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
