import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COURIER_ACTIVE_LIMIT,
  checkCancellation,
  checkCourierAssignment,
  checkCourierCapacity,
  checkCourierUnassignment,
  checkStatusTransition,
  startsOccupyingCourierSlot,
  type RuleResult,
} from './order-rules.js';
import { ORDER_STATUSES, type OrderStatus } from './order-status.js';

function violationCode(result: RuleResult): string | undefined {
  return result.ok ? undefined : result.violation.code;
}

describe('checkStatusTransition', () => {
  it('разрешает штатный шаг конвейера', () => {
    expect(
      checkStatusTransition({ currentStatus: 'new', requestedStatus: 'accepted', hasCourier: false }),
    ).toEqual({ ok: true });
  });

  it('отклоняет перепрыгивание через статус', () => {
    const result = checkStatusTransition({
      currentStatus: 'new',
      requestedStatus: 'ready',
      hasCourier: true,
    });
    expect(violationCode(result)).toBe('ORDER_INVALID_TRANSITION');
  });

  it('в деталях ошибки перечисляет допустимые статусы — их показывает UI', () => {
    const result = checkStatusTransition({
      currentStatus: 'accepted',
      requestedStatus: 'delivered',
      hasCourier: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violation.details).toMatchObject({
      currentStatus: 'accepted',
      requestedStatus: 'delivered',
      allowedStatuses: ['preparing', 'cancelled'],
    });
  });

  it.each(['delivered', 'cancelled'] as const)('отклоняет изменение терминального %s', (status) => {
    const result = checkStatusTransition({
      currentStatus: status,
      requestedStatus: 'accepted',
      hasCourier: true,
    });
    expect(violationCode(result)).toBe('ORDER_TERMINAL');
  });

  it('отклоняет повторную установку того же статуса', () => {
    const result = checkStatusTransition({
      currentStatus: 'preparing',
      requestedStatus: 'preparing',
      hasCourier: true,
    });
    expect(violationCode(result)).toBe('ORDER_INVALID_TRANSITION');
  });

  it('требует курьера при переходе в ready', () => {
    const result = checkStatusTransition({
      currentStatus: 'preparing',
      requestedStatus: 'ready',
      hasCourier: false,
    });
    expect(violationCode(result)).toBe('ORDER_COURIER_REQUIRED');
  });

  it('пропускает переход в ready, когда курьер назначен', () => {
    expect(
      checkStatusTransition({
        currentStatus: 'preparing',
        requestedStatus: 'ready',
        hasCourier: true,
      }).ok,
    ).toBe(true);
  });

  it('не требует курьера до ready', () => {
    expect(
      checkStatusTransition({
        currentStatus: 'accepted',
        requestedStatus: 'preparing',
        hasCourier: false,
      }).ok,
    ).toBe(true);
  });

  it('всегда возвращает понятное сообщение при отказе', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const result = checkStatusTransition({
          currentStatus: from,
          requestedStatus: to,
          hasCourier: false,
        });
        if (!result.ok) {
          expect(result.violation.message.length).toBeGreaterThan(10);
        }
      }
    }
  });
});

describe('checkCancellation', () => {
  it.each(['new', 'accepted', 'preparing', 'ready'] as const)('разрешает отмену из %s', (status) => {
    expect(checkCancellation({ currentStatus: status })).toEqual({ ok: true });
  });

  it('запрещает отмену после передачи курьеру', () => {
    expect(violationCode(checkCancellation({ currentStatus: 'picked_up' }))).toBe(
      'ORDER_NOT_CANCELLABLE',
    );
  });

  it('сообщает отдельно про уже доставленный и уже отменённый заказ', () => {
    const delivered = checkCancellation({ currentStatus: 'delivered' });
    const cancelled = checkCancellation({ currentStatus: 'cancelled' });
    expect(violationCode(delivered)).toBe('ORDER_TERMINAL');
    expect(violationCode(cancelled)).toBe('ORDER_TERMINAL');
    if (delivered.ok || cancelled.ok) return;
    expect(delivered.violation.message).not.toBe(cancelled.violation.message);
  });
});

describe('startsOccupyingCourierSlot', () => {
  it('срабатывает на входе в ready', () => {
    expect(startsOccupyingCourierSlot('preparing', 'ready')).toBe(true);
  });

  it('не срабатывает внутри активной зоны', () => {
    expect(startsOccupyingCourierSlot('ready', 'picked_up')).toBe(false);
  });

  it('не срабатывает на выходе из активной зоны', () => {
    expect(startsOccupyingCourierSlot('picked_up', 'delivered')).toBe(false);
  });
});

describe('checkCourierCapacity', () => {
  const base = { courierId: 'c-1', courierName: 'Иван', activeOrderIds: [] as string[] };

  it('лимит по умолчанию — 3', () => {
    expect(DEFAULT_COURIER_ACTIVE_LIMIT).toBe(3);
  });

  it.each([0, 1, 2])('пропускает при %i активных заказах', (activeCount) => {
    expect(checkCourierCapacity({ ...base, activeCount }).ok).toBe(true);
  });

  it('отклоняет четвёртый активный заказ', () => {
    const result = checkCourierCapacity({
      ...base,
      activeCount: 3,
      activeOrderIds: ['o-1', 'o-2', 'o-3'],
    });
    expect(violationCode(result)).toBe('COURIER_CAPACITY_EXCEEDED');
    if (result.ok) return;
    expect(result.violation.details).toMatchObject({
      activeCount: 3,
      limit: 3,
      activeOrderIds: ['o-1', 'o-2', 'o-3'],
    });
    expect(result.violation.message).toContain('Иван');
  });

  it('уважает переопределённый лимит', () => {
    expect(checkCourierCapacity({ ...base, activeCount: 3, limit: 5 }).ok).toBe(true);
    expect(checkCourierCapacity({ ...base, activeCount: 1, limit: 1 }).ok).toBe(false);
  });

  it('склоняет слово «заказ» по-русски', () => {
    const one = checkCourierCapacity({ ...base, activeCount: 1, limit: 1 });
    const three = checkCourierCapacity({ ...base, activeCount: 3, limit: 3 });
    const five = checkCourierCapacity({ ...base, activeCount: 5, limit: 5 });
    if (one.ok || three.ok || five.ok) throw new Error('ожидались отказы');
    expect(one.violation.message).toContain('1 заказ ');
    expect(three.violation.message).toContain('3 заказа');
    expect(five.violation.message).toContain('5 заказов');
  });
});

describe('checkCourierAssignment', () => {
  const active = { courierIsActive: true, courierName: 'Мария' };

  it.each(['new', 'accepted', 'preparing', 'ready', 'picked_up'] as OrderStatus[])(
    'разрешает назначение в статусе %s',
    (orderStatus) => {
      expect(checkCourierAssignment({ ...active, orderStatus }).ok).toBe(true);
    },
  );

  it.each(['delivered', 'cancelled'] as OrderStatus[])(
    'запрещает трогать курьера в терминальном %s',
    (orderStatus) => {
      expect(violationCode(checkCourierAssignment({ ...active, orderStatus }))).toBe('ORDER_TERMINAL');
    },
  );

  it('запрещает назначение неактивного курьера', () => {
    const result = checkCourierAssignment({
      orderStatus: 'new',
      courierIsActive: false,
      courierName: 'Пётр',
    });
    expect(violationCode(result)).toBe('COURIER_INACTIVE');
  });
});

describe('checkCourierUnassignment', () => {
  it('разрешает снять курьера до ready', () => {
    expect(checkCourierUnassignment({ orderStatus: 'preparing', hasCourier: true }).ok).toBe(true);
  });

  it('запрещает снять курьера с заказа, который уже в доставке', () => {
    expect(
      violationCode(checkCourierUnassignment({ orderStatus: 'ready', hasCourier: true })),
    ).toBe('ORDER_COURIER_REQUIRED');
  });

  it('сообщает, если курьера и так нет', () => {
    expect(
      violationCode(checkCourierUnassignment({ orderStatus: 'new', hasCourier: false })),
    ).toBe('ORDER_COURIER_NOT_ASSIGNED');
  });

  it('запрещает изменение терминального заказа', () => {
    expect(
      violationCode(checkCourierUnassignment({ orderStatus: 'delivered', hasCourier: true })),
    ).toBe('ORDER_TERMINAL');
  });
});
