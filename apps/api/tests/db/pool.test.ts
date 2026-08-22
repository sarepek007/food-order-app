import { describe, expect, it, vi } from 'vitest';
import { createPool } from '../../src/db/pool.js';
import { testDatabaseUrl } from '../helpers/test-db.js';

describe('устойчивость пула соединений', () => {
  it('слушатель ошибок установлен: без него перезапуск БД убивал бы процесс', async () => {
    const pool = createPool({ connectionString: testDatabaseUrl(), applicationName: 'pool-test' });

    try {
      // Событие `error` без слушателя в Node — необработанное исключение.
      expect(pool.listenerCount('error')).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });

  it('ошибка простаивающего соединения уходит в обработчик, а не наружу', async () => {
    const onError = vi.fn();
    const pool = createPool({
      connectionString: testDatabaseUrl(),
      applicationName: 'pool-test',
      onError,
    });

    try {
      // Так же, как это делает драйвер при обрыве соединения.
      pool.emit('error', new Error('соединение разорвано'), undefined as never);

      expect(onError).toHaveBeenCalledTimes(1);
      expect((onError.mock.calls[0]?.[0] as Error).message).toBe('соединение разорвано');
    } finally {
      await pool.end();
    }
  });

  it('запросы продолжают работать после сообщения об ошибке', async () => {
    const pool = createPool({
      connectionString: testDatabaseUrl(),
      applicationName: 'pool-test',
      onError: () => undefined,
    });

    try {
      pool.emit('error', new Error('временный обрыв'), undefined as never);

      const { rows } = await pool.query<{ ok: number }>('SELECT 1 AS ok');
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
