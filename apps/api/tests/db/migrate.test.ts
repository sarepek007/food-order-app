import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readMigrations, runMigrations } from '../../src/db/migrate.js';
import { createPool, type DbPool } from '../../src/db/pool.js';
import { createTestPool, testDatabaseUrl } from '../helpers/test-db.js';

/**
 * Тесты раннера работают в отдельной схеме: они создают и роняют объекты,
 * и не должны пересекаться со схемой, на которой идут остальные тесты.
 */
const SCHEMA = 'migrate_test';

const adminPool: DbPool = createTestPool('migrate-test-admin');

/**
 * public остаётся в search_path вторым: расширение pg_trgm ставится один раз
 * на базу, и без него не резолвится класс операторов gin_trgm_ops.
 */
function scopedPool(): DbPool {
  const url = new URL(testDatabaseUrl());
  url.searchParams.set('options', `-c search_path=${SCHEMA},public`);
  return createPool({ connectionString: url.toString(), applicationName: 'migrate-test' });
}

let pool: DbPool = scopedPool();

beforeEach(async () => {
  await pool.end().catch(() => undefined);
  await adminPool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await adminPool.query(`CREATE SCHEMA ${SCHEMA}`);
  pool = scopedPool();
});

afterAll(async () => {
  await pool.end().catch(() => undefined);
  await adminPool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await adminPool.end();
});

async function tempMigrations(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'food-migrations-'));
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(dir, name), sql, 'utf8');
  }
  return `${dir}/`;
}

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`${SCHEMA}.${name}`],
  );
  return rows[0]!.exists;
}

describe('чтение миграций', () => {
  it('находит миграции проекта и сортирует их по имени', async () => {
    const migrations = await readMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]?.id).toBe('0001_init.sql');
    expect([...migrations].sort((a, b) => a.id.localeCompare(b.id))).toEqual(migrations);
  });

  it('считает контрольную сумму для каждой миграции', async () => {
    const migrations = await readMigrations();
    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});

describe('применение миграций', () => {
  it('применяет полный набор на чистой схеме', async () => {
    const result = await runMigrations(pool);

    expect(result.applied).toContain('0001_init.sql');
    expect(result.skipped).toHaveLength(0);
    expect(await tableExists('orders')).toBe(true);
    expect(await tableExists('order_audit_log')).toBe(true);
  });

  it('повторный запуск ничего не применяет — раннер идемпотентен', async () => {
    await runMigrations(pool);
    const second = await runMigrations(pool);

    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toContain('0001_init.sql');
  });

  it('фиксирует применённые миграции в schema_migrations', async () => {
    await runMigrations(pool);
    const { rows } = await pool.query<{ id: string; execution_ms: number }>(
      'SELECT id, execution_ms FROM schema_migrations ORDER BY id',
    );

    expect(rows[0]?.id).toBe('0001_init.sql');
    expect(rows[0]?.execution_ms).toBeGreaterThanOrEqual(0);
  });

  it('отклоняет изменение уже применённой миграции', async () => {
    const dir = await tempMigrations({ '0001_probe.sql': 'CREATE TABLE probe (id int);' });
    await runMigrations(pool, { dir });

    const changed = await tempMigrations({
      '0001_probe.sql': 'CREATE TABLE probe (id int, extra text);',
    });

    await expect(runMigrations(pool, { dir: changed })).rejects.toThrow(
      /изменена после применения/,
    );
  });

  it('откатывает миграцию целиком, если SQL падает в середине', async () => {
    const dir = await tempMigrations({
      '0001_ok.sql': 'CREATE TABLE first_table (id int);',
      '0002_broken.sql': 'CREATE TABLE second_table (id int); SELECT 1 / 0;',
    });

    await expect(runMigrations(pool, { dir })).rejects.toThrow(/0002_broken\.sql/);

    expect(await tableExists('first_table')).toBe(true);
    expect(await tableExists('second_table')).toBe(false);

    const { rows } = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
    expect(rows.map((row) => row.id)).toEqual(['0001_ok.sql']);
  });

  it('продолжает с места остановки после исправления', async () => {
    const broken = await tempMigrations({
      '0001_ok.sql': 'CREATE TABLE first_table (id int);',
      '0002_broken.sql': 'SELECT 1 / 0;',
    });
    await expect(runMigrations(pool, { dir: broken })).rejects.toThrow();

    const fixed = await tempMigrations({
      '0001_ok.sql': 'CREATE TABLE first_table (id int);',
      '0002_broken.sql': 'CREATE TABLE second_table (id int);',
    });
    const result = await runMigrations(pool, { dir: fixed });

    expect(result.applied).toEqual(['0002_broken.sql']);
    expect(result.skipped).toEqual(['0001_ok.sql']);
  });

  it('два параллельных запуска не конфликтуют благодаря advisory-локу', async () => {
    const other = scopedPool();
    try {
      const results = await Promise.all([runMigrations(pool), runMigrations(other)]);
      const appliedTotal = results.flatMap((result) => result.applied);

      // Миграция применяется ровно один раз, второй процесс её пропускает.
      expect(appliedTotal.filter((id) => id === '0001_init.sql')).toHaveLength(1);
      expect(await tableExists('orders')).toBe(true);
    } finally {
      await other.end();
    }
  });
});
