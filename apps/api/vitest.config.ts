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
      exclude: ['src/**/*.test.ts', 'src/**/*-cli.ts', 'src/main.ts'],
    },
  },
});
