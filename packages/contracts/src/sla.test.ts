import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, isTerminal, type OrderStatus } from './order-status.js';
import {
  DEFAULT_STATUS_SLA_SECONDS,
  SLA_WARNING_RATIO,
  formatDuration,
  isOverdue,
  secondsToDeadline,
  slaLimitFor,
  slaStateFor,
} from './sla.js';

describe('нормативы', () => {
  it('заданы для всех нетерминальных статусов', () => {
    for (const status of ORDER_STATUSES) {
      const limit = slaLimitFor(status);
      if (isTerminal(status)) {
        expect(limit, `терминальный ${status}`).toBeNull();
      } else {
        expect(limit, `рабочий ${status}`).toBeGreaterThan(0);
      }
    }
  });

  it('таблица нормативов заморожена от мутаций', () => {
    expect(Object.isFrozen(DEFAULT_STATUS_SLA_SECONDS)).toBe(true);
  });
});

describe('slaStateFor', () => {
  it('у терминальных статусов норматива нет', () => {
    expect(slaStateFor({ status: 'delivered', secondsInStatus: 10_000 })).toBe('none');
    expect(slaStateFor({ status: 'cancelled', secondsInStatus: 10_000 })).toBe('none');
  });

  it('в начале статуса — в пределах норматива', () => {
    expect(slaStateFor({ status: 'preparing', secondsInStatus: 60 })).toBe('ok');
  });

  it('предупреждает, когда норматив почти исчерпан', () => {
    const limit = slaLimitFor('preparing')!;
    expect(slaStateFor({ status: 'preparing', secondsInStatus: limit * SLA_WARNING_RATIO })).toBe(
      'warning',
    );
    expect(slaStateFor({ status: 'preparing', secondsInStatus: limit })).toBe('warning');
  });

  it('превышение норматива даёт просрочку', () => {
    const limit = slaLimitFor('preparing')!;
    expect(slaStateFor({ status: 'preparing', secondsInStatus: limit + 1 })).toBe('overdue');
  });

  it('граница между ok и warning ровно на пороге', () => {
    const limit = slaLimitFor('new')!;
    const threshold = limit * SLA_WARNING_RATIO;
    expect(slaStateFor({ status: 'new', secondsInStatus: threshold - 1 })).toBe('ok');
    expect(slaStateFor({ status: 'new', secondsInStatus: threshold })).toBe('warning');
  });

  it('отрицательное время трактуется как ноль, а не как выполненный норматив', () => {
    // Рассинхрон часов между сервером и клиентом не должен «чинить» просрочку.
    expect(slaStateFor({ status: 'new', secondsInStatus: -10_000 })).toBe('ok');
  });

  it('уважает переопределённые нормативы', () => {
    const strict = { ...DEFAULT_STATUS_SLA_SECONDS, preparing: 60 };
    expect(slaStateFor({ status: 'preparing', secondsInStatus: 120, sla: strict })).toBe('overdue');
    expect(slaStateFor({ status: 'preparing', secondsInStatus: 120 })).toBe('ok');
  });

  it('isOverdue согласован с slaStateFor', () => {
    for (const status of ORDER_STATUSES) {
      for (const seconds of [0, 100, 1_000, 100_000]) {
        const input = { status: status as OrderStatus, secondsInStatus: seconds };
        expect(isOverdue(input)).toBe(slaStateFor(input) === 'overdue');
      }
    }
  });
});

describe('secondsToDeadline', () => {
  it('возвращает остаток до нарушения норматива', () => {
    expect(secondsToDeadline({ status: 'new', secondsInStatus: 60 })).toBe(
      slaLimitFor('new')! - 60,
    );
  });

  it('отрицательное значение показывает величину просрочки', () => {
    const limit = slaLimitFor('new')!;
    expect(secondsToDeadline({ status: 'new', secondsInStatus: limit + 120 })).toBe(-120);
  });

  it('у терминального статуса срока нет', () => {
    expect(secondsToDeadline({ status: 'delivered', secondsInStatus: 5 })).toBeNull();
  });
});

describe('formatDuration', () => {
  it.each([
    [0, 'меньше минуты'],
    [59, 'меньше минуты'],
    [60, '1 мин'],
    [40 * 60, '40 мин'],
    [60 * 60, '1 ч'],
    [135 * 60, '2 ч 15 мин'],
    [24 * 60 * 60, '1 дн'],
    [27 * 60 * 60, '1 дн 3 ч'],
  ])('%i секунд → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('не ломается на отрицательном значении', () => {
    expect(formatDuration(-100)).toBe('меньше минуты');
  });
});
