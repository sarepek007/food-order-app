import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  canonicalizeRequestBody,
  isValidIdempotencyKey,
} from './idempotency.js';

describe('валидация ключа', () => {
  it('принимает UUID и другие печатаемые ASCII-строки', () => {
    expect(isValidIdempotencyKey('9f1c2a4e-2f3a-4c1b-9c1e-3a2b1c4d5e6f')).toBe(true);
    expect(isValidIdempotencyKey('order-42-retry-1')).toBe(true);
  });

  it('отклоняет слишком короткий и слишком длинный ключ', () => {
    expect(isValidIdempotencyKey('a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH - 1))).toBe(false);
    expect(isValidIdempotencyKey('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH))).toBe(true);
    expect(isValidIdempotencyKey('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1))).toBe(false);
  });

  it('отклоняет не-ASCII: в заголовке такое значение исказится', () => {
    expect(isValidIdempotencyKey('ключ-повтора-1')).toBe(false);
  });

  it('отклоняет пробелы и управляющие символы', () => {
    expect(isValidIdempotencyKey('key with space')).toBe(false);
    expect(isValidIdempotencyKey('key\nnewline')).toBe(false);
  });
});

describe('канонический вид тела', () => {
  it('не зависит от порядка ключей', () => {
    expect(canonicalizeRequestBody({ status: 'accepted', comment: 'ок' })).toBe(
      canonicalizeRequestBody({ comment: 'ок', status: 'accepted' }),
    );
  });

  it('различает разные значения', () => {
    expect(canonicalizeRequestBody({ status: 'accepted' })).not.toBe(
      canonicalizeRequestBody({ status: 'preparing' }),
    );
  });

  it('сортирует вложенные объекты', () => {
    expect(canonicalizeRequestBody({ a: { y: 1, x: 2 } })).toBe('{"a":{"x":2,"y":1}}');
  });

  it('сохраняет порядок массивов — он несёт смысл', () => {
    expect(canonicalizeRequestBody([2, 1])).not.toBe(canonicalizeRequestBody([1, 2]));
  });

  it('работает с пустым телом', () => {
    expect(canonicalizeRequestBody(undefined)).toBe(undefined);
    expect(canonicalizeRequestBody(null)).toBe('null');
  });
});
