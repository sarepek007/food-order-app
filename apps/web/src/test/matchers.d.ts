/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

/**
 * Матчеры jest-dom подключаются вручную в setup.ts, поэтому их типы
 * тоже объявляются здесь: готовая точка входа завязана на версию vitest.
 * `any` в параметре обязателен — объявление должно совпадать с исходным.
 */
declare module 'vitest' {
  interface Assertion<T = any> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, void> {}
}

export {};
