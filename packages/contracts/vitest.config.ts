import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text-summary', 'html', 'lcov'],
      /**
       * Пороги стоят чуть ниже текущего покрытия: они защищают от регрессии,
       * а не требуют дописывать тесты ради процентов. Поднимаются осознанно,
       * когда покрытие выросло.
       */
      thresholds: {
        statements: 88,
        branches: 90,
        functions: 92,
        lines: 88,
      },
    },
  },
});
