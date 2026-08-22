import { defineConfig, devices } from '@playwright/test';

/**
 * E2E проходят по живому стеку.
 *
 * По умолчанию поднимается **изолированная** пара серверов на собственных
 * портах и собственной базе: сценарии создают и меняют заказы, и делать это
 * в базе демонстрационного стенда нельзя — иначе после каждого прогона
 * в списке остаются заказы вида «E2E Клиент 1787393113620».
 *
 * Против уже работающего стека (например, docker compose):
 *   E2E_BASE_URL=http://localhost:8080 E2E_API_URL=http://localhost:8080 pnpm test:e2e
 * В этом режиме изоляции нет — проверяется реальное развёртывание.
 */
const E2E_API_PORT = 3100;
const E2E_WEB_PORT = 5174;
const E2E_DATABASE_URL =
  process.env['E2E_DATABASE_URL'] ?? 'postgres://food:food@localhost:5432/food_orders_e2e';

const externalBaseUrl = process.env['E2E_BASE_URL'];
const baseURL = externalBaseUrl ?? `http://localhost:${E2E_WEB_PORT}`;
const apiUrl = process.env['E2E_API_URL'] ?? `http://localhost:${E2E_API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // Тесты меняют состояние заказов, поэтому идут последовательно.
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  ...(externalBaseUrl
    ? {}
    : {
        // Готовит изолированную базу: создаёт её при необходимости,
        // применяет миграции и загружает воспроизводимые данные.
        globalSetup: './e2e/global-setup.ts',
        webServer: [
          {
            command: 'pnpm --filter @food/api dev',
            url: `${apiUrl}/api/v1/health`,
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
              DATABASE_URL: E2E_DATABASE_URL,
              PORT: String(E2E_API_PORT),
              LOG_LEVEL: 'warn',
            },
          },
          {
            command: 'pnpm --filter @food/web dev',
            url: baseURL,
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
              PORT: String(E2E_WEB_PORT),
              API_PROXY_TARGET: apiUrl,
            },
          },
        ],
      }),
});
