import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { DbPool } from '../../src/db/pool.js';
import { testDatabaseUrl } from './test-db.js';
import { TEST_COURIER_LIMIT } from './service.js';

/** Приложение поверх тестового пула. Порт не занимается — запросы идут через inject. */
export async function createTestApp(pool: DbPool): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDatabaseUrl(),
    COURIER_ACTIVE_LIMIT: String(TEST_COURIER_LIMIT),
    SEARCH_SIMILARITY_THRESHOLD: '0.5',
  });

  return buildApp({ config, pool });
}
