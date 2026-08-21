import { describe, expect, it } from 'vitest';
import { isValidIdempotencyKey } from '@food/contracts';
import { idempotencyKeyFor } from './idempotency';

const ORDER = '11111111-1111-4111-8111-111111111111';

describe('idempotencyKeyFor', () => {
  it('одно и то же действие даёт один и тот же ключ — двойной клик безопасен', () => {
    const action = { kind: 'status', status: 'accepted' };
    expect(idempotencyKeyFor(ORDER, '"3"', action)).toBe(idempotencyKeyFor(ORDER, '"3"', action));
  });

  it('не зависит от порядка полей в действии', () => {
    expect(idempotencyKeyFor(ORDER, '"3"', { kind: 'cancel', reason: 'ок' })).toBe(
      idempotencyKeyFor(ORDER, '"3"', { reason: 'ок', kind: 'cancel' }),
    );
  });

  it('другая версия заказа — другой ключ', () => {
    const action = { kind: 'status', status: 'accepted' };
    expect(idempotencyKeyFor(ORDER, '"3"', action)).not.toBe(
      idempotencyKeyFor(ORDER, '"4"', action),
    );
  });

  it('другое действие — другой ключ', () => {
    expect(idempotencyKeyFor(ORDER, '"3"', { kind: 'status', status: 'accepted' })).not.toBe(
      idempotencyKeyFor(ORDER, '"3"', { kind: 'status', status: 'preparing' }),
    );
  });

  it('другой заказ — другой ключ', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const action = { kind: 'status', status: 'accepted' };
    expect(idempotencyKeyFor(ORDER, '"3"', action)).not.toBe(idempotencyKeyFor(other, '"3"', action));
  });

  it('различает причины отмены на кириллице', () => {
    expect(idempotencyKeyFor(ORDER, '"1"', { kind: 'cancel', reason: 'клиент передумал' })).not.toBe(
      idempotencyKeyFor(ORDER, '"1"', { kind: 'cancel', reason: 'ресторан закрыт' }),
    );
  });

  it('всегда даёт ключ, приемлемый для заголовка', () => {
    const keys = [
      idempotencyKeyFor(ORDER, '"1"', { kind: 'unassign-courier' }),
      idempotencyKeyFor(ORDER, '*', { kind: 'cancel', reason: 'очень длинная причина '.repeat(20) }),
    ];

    for (const key of keys) {
      expect(isValidIdempotencyKey(key), key).toBe(true);
    }
  });
});
