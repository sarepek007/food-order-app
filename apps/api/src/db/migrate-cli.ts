import process from 'node:process';
import { getConfig } from '../config.js';
import { runMigrations } from './migrate.js';
import { createPoolFromConfig } from './pool.js';

const config = getConfig();
const pool = createPoolFromConfig(config);

try {
  const result = await runMigrations(pool, {
    // eslint-disable-next-line no-console
    log: (message) => console.log(`[migrate] ${message}`),
  });

  if (result.applied.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] актуально, применено ранее: ${result.skipped.length}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[migrate] готово, применено: ${result.applied.length}`);
  }
} catch (error) {
  console.error(`[migrate] ошибка: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
