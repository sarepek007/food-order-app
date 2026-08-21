import process from 'node:process';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { testDatabaseUrl } from './helpers/test-db.js';

/**
 * Тестовая БД пересоздаётся один раз на прогон: схема всегда соответствует
 * актуальным миграциям, а тесты не зависят от порядка запуска.
 */
export async function setup(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // .env необязателен — в CI переменные приходят из окружения.
  }

  const pool = createPool({ connectionString: testDatabaseUrl(), applicationName: 'food-order-test-setup' });

  try {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    const result = await runMigrations(pool);
    if (result.applied.length === 0) {
      throw new Error('Миграции не применились — тестовая схема пуста');
    }
  } catch (error) {
    throw new Error(
      `Не удалось подготовить тестовую БД (${testDatabaseUrl()}). ` +
        'Запущен ли Postgres? `pnpm db:up`. Исходная ошибка: ' +
        (error as Error).message,
      { cause: error },
    );
  } finally {
    await pool.end();
  }
}
