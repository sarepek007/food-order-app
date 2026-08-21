import process from 'node:process';
import { buildApp } from './app.js';
import { getConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createPoolFromConfig } from './db/pool.js';
import { deleteExpiredIdempotencyKeys } from './repositories/idempotency-repository.js';

const config = getConfig();
const pool = createPoolFromConfig(config);

const app = await buildApp({ config, pool });

try {
  // Миграции применяются на старте: контейнер должен подниматься одной командой,
  // а раннер идемпотентен и защищён advisory-локом от параллельных реплик.
  const result = await runMigrations(pool, { log: (message) => app.log.info(message) });
  app.log.info({ applied: result.applied.length, skipped: result.skipped.length }, 'миграции проверены');

  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'не удалось запустить сервис');
  await pool.end().catch(() => undefined);
  process.exit(1);
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
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'ошибка при завершении');
        process.exit(1);
      });
  });
}
