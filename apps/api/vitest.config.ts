import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/global-setup.ts'],
    // Интеграционные тесты делят одну БД: параллельный прогон файлов
    // приводил бы к взаимному TRUNCATE. Параллелизм внутри теста сохраняется —
    // именно на нём построены проверки конкурентности.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Точки входа и CLI проверяются запуском, а не юнит-тестами.
      exclude: ['src/**/*.test.ts', 'src/**/*-cli.ts', 'src/main.ts'],
      reporter: ['text-summary', 'html', 'lcov'],
      // Пороги чуть ниже текущего покрытия: защита от регрессии,
      // а не гонка за процентами.
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 88,
        lines: 90,
      },
    },
  },
});
