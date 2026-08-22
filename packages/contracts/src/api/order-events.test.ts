import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../domain/audit.js';
import { describeOrderChange, isOrderChangeEvent, type OrderChangeEvent } from './order-events.js';

function event(overrides: Partial<OrderChangeEvent> = {}): OrderChangeEvent {
  return {
    orderId: '11111111-1111-4111-8111-111111111111',
    action: 'STATUS_CHANGED',
    oldStatus: 'new',
    newStatus: 'accepted',
    version: 2,
    actor: 'Анна',
    at: '2026-05-21T12:00:00.000Z',
    ...overrides,
  };
}

describe('describeOrderChange', () => {
  it('описывает смену статуса по-русски', () => {
    expect(describeOrderChange(event())).toBe('статус «Новый» → «Принят»');
  });

  it('переживает отсутствие статусов в событии', () => {
    expect(describeOrderChange(event({ oldStatus: null, newStatus: null }))).toBe('статус изменён');
  });

  it.each(AUDIT_ACTIONS)('даёт непустое описание для %s', (action) => {
    expect(describeOrderChange(event({ action })).length).toBeGreaterThan(3);
  });
});

describe('isOrderChangeEvent', () => {
  it('принимает корректное событие', () => {
    expect(isOrderChangeEvent(event())).toBe(true);
  });

  it.each([[null], [undefined], ['строка'], [{}], [{ orderId: 1 }]])('отклоняет %s', (value) => {
    expect(isOrderChangeEvent(value)).toBe(false);
  });
});
