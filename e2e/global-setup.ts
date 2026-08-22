import { execFileSync } from 'node:child_process';
import process from 'node:process';

/**
 * Готовит изолированную базу для e2e до старта серверов.
 *
 * Скрипт живёт в apps/api, потому что ему нужны и раннер миграций,
 * и генератор данных — дублировать их здесь было бы хуже.
 */
export default function globalSetup(): void {
  const databaseUrl =
    process.env['E2E_DATABASE_URL'] ?? 'postgres://food:food@localhost:5432/food_orders_e2e';

  execFileSync('pnpm', ['--filter', '@food/api', 'prepare:e2e-db'], {
    stdio: 'inherit',
    env: { ...process.env, E2E_DATABASE_URL: databaseUrl },
  });
}
