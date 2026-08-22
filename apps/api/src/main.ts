import process from 'node:process';
import { buildApp } from './app.js';
import { getConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createPoolFromConfig } from './db/pool.js';
import { createOrderEvents } from './realtime/order-events.js';
import { deleteExpiredIdempotencyKeys } from './repositories/idempotency-repository.js';
import { runSeed } from './seed/seed.js';

const config = getConfig();

/**
 * Логгер приложения появляется позже пула, поэтому обработчик ошибок
 * подменяется через ссылку: до готовности приложения пишем в консоль.
 */
let reportPoolError = (error: Error): void => {
  console.error('ошибка соединения с БД', error);
};

const pool = createPoolFromConfig(config, { onError: (error) => reportPoolError(error) });

const events = createOrderEvents(config);
const app = await buildApp({ config, pool, events });

reportPoolError = (error: Error): void => {
  // Не fatal: сервис переживает перезапуск базы и сам восстановит соединения.
  app.log.error({ err: error }, 'ошибка соединения с БД');
};

try {
  // Миграции применяются на старте: контейнер должен подниматься одной командой,
  // а раннер идемпотентен и защищён advisory-локом от параллельных реплик.
  const result = await runMigrations(pool, { log: (message) => app.log.info(message) });
  app.log.info({ applied: result.applied.length, skipped: result.skipped.length }, 'миграции проверены');

  if (config.SEED_ON_EMPTY) {
    await seedIfEmpty();
  }

  // Подписка поднимается до приёма запросов: клиент, подключившийся сразу,
  // не должен получить поток без источника событий.
  await events.start();

  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'не удалось запустить сервис');
  await events.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
}

/**
 * Загружает демонстрационные данные, если база пуста.
 *
 * Лок сессионный, а не транзакционный: runSeed открывает собственную
 * транзакцию на другом соединении, и транзакционный лок её не накрыл бы.
 * Тот же приём, что в раннере миграций.
 */
async function seedIfEmpty(): Promise<void> {
  const SEED_LOCK_KEY = 8_421_775_093;
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_KEY]);

    // Проверяются все три таблицы: наполнять базу, где уже есть справочники,
    // нельзя — seed вставляет записи с фиксированными идентификаторами.
    const { rows } = await client.query<{ total: string }>(
      `SELECT (SELECT count(*) FROM orders)
            + (SELECT count(*) FROM restaurants)
            + (SELECT count(*) FROM couriers) AS total`,
    );

    if (Number(rows[0]?.total ?? 0) > 0) {
      app.log.info('данные уже есть, загрузка демонстрационного набора пропущена');
      return;
    }

    app.log.info('база пуста — загружаем демонстрационные данные');
    const summary = await runSeed(pool, {
      reset: false,
      courierActiveLimit: config.COURIER_ACTIVE_LIMIT,
    });
    app.log.info(
      { restaurants: summary.restaurants, couriers: summary.couriers, orders: summary.orders },
      'демонстрационные данные загружены',
    );
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/**
 * Уборка просроченных ключей идемпотентности. Вынесена с горячего пути:
 * запрос не должен платить за обслуживание таблицы. unref() позволяет
 * процессу завершиться, не дожидаясь следующего срабатывания.
 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const cleanupTimer = setInterval(() => {
  void deleteExpiredIdempotencyKeys(createDatabase(pool))
    .then((removed) => {
      if (removed > 0) {
        app.log.info({ removed }, 'удалены просроченные ключи идемпотентности');
      }
    })
    .catch((error: unknown) => {
      app.log.warn({ err: error }, 'не удалось убрать просроченные ключи идемпотентности');
    });
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

/** Корректное завершение: дорабатываем текущие запросы и закрываем пул. */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'получен сигнал завершения');
    clearInterval(cleanupTimer);
    void app
      .close()
      .then(() => events.stop())
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'ошибка при завершении');
        process.exit(1);
      });
  });
}
