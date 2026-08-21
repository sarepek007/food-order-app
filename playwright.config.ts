import { defineConfig, devices } from '@playwright/test';

/**
 * E2E проходят по живому стеку. По умолчанию поднимаются dev-серверы,
 * но можно указать уже работающий адрес: E2E_BASE_URL=http://localhost:8080
 * (например, стек из docker compose).
 */
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const useExternalStack = Boolean(process.env['E2E_BASE_URL']);

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
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  ...(useExternalStack
    ? {}
    : {
        webServer: [
          {
            command: 'pnpm --filter @food/api dev',
            url: `${API_URL}/api/v1/health`,
            reuseExistingServer: true,
            timeout: 60_000,
          },
          {
            command: 'pnpm --filter @food/web dev',
            url: BASE_URL,
            reuseExistingServer: true,
            timeout: 60_000,
          },
        ],
      }),
});
