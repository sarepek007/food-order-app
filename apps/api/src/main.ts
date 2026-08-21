import process from 'node:process';
import { buildApp } from './app.js';
import { getConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createPoolFromConfig } from './db/pool.js';

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

/** Корректное завершение: дорабатываем текущие запросы и закрываем пул. */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'получен сигнал завершения');
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
