import process from 'node:process';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // PORT позволяет внешнему запускающему процессу назначить порт;
    // 5173 остаётся значением по умолчанию для ручного запуска.
    port: Number(process.env['PORT'] ?? 5173),
    // Прокси убирает CORS из разработки: фронт и API живут на одном origin.
    // Адрес настраивается, потому что e2e поднимают собственный экземпляр API
    // поверх изолированной базы.
    proxy: {
      '/api': {
        target: process.env['API_PROXY_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        // Тестовая обвязка и точка входа: проверяются запуском приложения.
        'src/test/**',
        'src/main.tsx',
        'src/**/*.d.ts',
      ],
      reporter: ['text-summary', 'html', 'lcov'],
      // Пороги чуть ниже текущего покрытия: защита от регрессии.
      thresholds: {
        statements: 86,
        branches: 80,
        functions: 85,
        lines: 88,
      },
    },
  },
});
