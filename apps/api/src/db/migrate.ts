import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { DbPool } from './pool.js';

/** Работает и из src (tsx), и из dist: обе директории лежат на одном уровне. */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/**
 * Ключ advisory-лока миграций. Один процесс применяет миграции за раз —
 * иначе параллельный старт двух реплик даёт гонку на CREATE TABLE.
 */
const MIGRATION_LOCK_KEY = 4_812_003_117;

export interface MigrationFile {
  id: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.trim()).digest('hex').slice(0, 32);
}

export async function readMigrations(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();

  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(new URL(name, `file://${dir}`), 'utf8');
      return { id: name, sql, checksum: checksumOf(sql) };
    }),
  );
}

/** Принимает клиента, а не пул: создание таблицы обязано идти под advisory-локом. */
async function ensureMigrationsTable(client: Pick<DbPool, 'query'>): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id            text PRIMARY KEY,
      checksum      text        NOT NULL,
      execution_ms  integer     NOT NULL,
      applied_at    timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Применяет непрогнанные миграции по порядку имён файлов.
 * Каждая — в собственной транзакции: частично применённая миграция недопустима.
 */
export async function runMigrations(
  pool: DbPool,
  options: { dir?: string; log?: (message: string) => void } = {},
): Promise<MigrationResult> {
  const log = options.log ?? (() => {});
  const migrations = await readMigrations(options.dir);

  const lockClient = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    // Создание служебной таблицы тоже под локом: параллельный
    // CREATE TABLE IF NOT EXISTS в Postgres не атомарен и падает
    // на duplicate key в pg_type.
    await ensureMigrationsTable(lockClient);

    const { rows } = await lockClient.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM schema_migrations',
    );
    const alreadyApplied = new Map(rows.map((row) => [row.id, row.checksum]));

    for (const migration of migrations) {
      const knownChecksum = alreadyApplied.get(migration.id);

      if (knownChecksum !== undefined) {
        if (knownChecksum !== migration.checksum) {
          throw new Error(
            `Миграция ${migration.id} изменена после применения ` +
              `(ожидалась контрольная сумма ${knownChecksum}, получена ${migration.checksum}). ` +
              'Применённые миграции править нельзя — добавьте новую.',
          );
        }
        skipped.push(migration.id);
        continue;
      }

      const client = await pool.connect();
      const startedAt = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (id, checksum, execution_ms) VALUES ($1, $2, $3)',
          [migration.id, migration.checksum, Date.now() - startedAt],
        );
        await client.query('COMMIT');
        applied.push(migration.id);
        log(`применена ${migration.id} (${Date.now() - startedAt} мс)`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          `Миграция ${migration.id} не применена: ${(error as Error).message}`,
          { cause: error },
        );
      } finally {
        client.release();
      }
    }

    return { applied, skipped };
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    lockClient.release();
  }
}

/**
 * Полный сброс схемы. Используется только тестами и `seed --reset`:
 * в приложении удаление данных не предусмотрено.
 */
export async function resetSchema(pool: DbPool): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
}
