import pg from 'pg';
import type { AppConfig } from '../config.js';

const { Pool, types } = pg;

/**
 * numeric приходит из драйвера строкой — это поведение по умолчанию и менять
 * его нельзя: значение не помещается в double без потерь (см. ADR 0002).
 * int8 (bigserial) тоже оставляем строкой и приводим явно там, где нужно.
 */
types.setTypeParser(types.builtins.NUMERIC, (value) => value);

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;

export interface CreatePoolOptions {
  connectionString: string;
  max?: number;
  connectionTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  applicationName?: string;
  /** Куда сообщать об ошибках простаивающих соединений. */
  onError?: (error: Error) => void;
}

export function createPool(options: CreatePoolOptions): DbPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    // Защита от зависших запросов: без таймаута один тяжёлый запрос
    // выедает соединение из пула до перезапуска процесса.
    statement_timeout: options.statementTimeoutMillis ?? 10_000,
    application_name: options.applicationName ?? 'food-order-api',
  });

  /**
   * Обработчик обязателен, а не желателен.
   *
   * Пул сообщает об ошибке простаивающего соединения событием `error`.
   * В Node событие `error` без слушателя — необработанное исключение,
   * то есть перезапуск базы убивал бы весь процесс. С обработчиком сервис
   * остаётся жив: запросы в момент обрыва падают, а /health честно
   * отвечает 503, пока база не вернётся.
   */
  pool.on('error', (error) => {
    if (options.onError) {
      options.onError(error);
      return;
    }
    console.error('ошибка соединения с БД', error);
  });

  return pool;
}

export function createPoolFromConfig(
  config: AppConfig,
  options: { connectionString?: string; onError?: (error: Error) => void } = {},
): DbPool {
  return createPool({
    connectionString: options.connectionString ?? config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
    statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT_MS,
    ...(options.onError ? { onError: options.onError } : {}),
  });
}

/**
 * Выполняет функцию в транзакции. Клиент берётся из пула и возвращается
 * в любом исходе — включая ошибку самого ROLLBACK.
 */
export async function withTransaction<T>(
  pool: DbPool,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Соединение уже разорвано — исходную ошибку это не отменяет.
    }
    throw error;
  } finally {
    client.release();
  }
}
