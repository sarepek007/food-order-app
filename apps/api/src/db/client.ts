import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DbClient, DbPool } from './pool.js';
import { dbSchema } from './schema.js';

export type Database = NodePgDatabase<typeof dbSchema>;

/** Drizzle поверх готового пула: жизненным циклом соединений владеет пул. */
export function createDatabase(pool: DbPool): Database {
  return drizzle(pool, { schema: dbSchema, casing: 'snake_case' });
}

/**
 * Drizzle поверх конкретного клиента. Нужен внутри транзакции, где все запросы
 * обязаны идти через одно соединение — иначе блокировки берутся в разных сессиях.
 */
export function createTransactionalDatabase(client: DbClient): Database {
  return drizzle(client, { schema: dbSchema, casing: 'snake_case' });
}
