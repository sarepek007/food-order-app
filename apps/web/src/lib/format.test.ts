import { describe, expect, it } from 'vitest';
import { formatDateTime, formatMoney, formatPhone, formatRelative } from './format';

describe('formatMoney', () => {
  it('форматирует рубли с копейками', () => {
    // Пробелы в выводе Intl — неразрывные, поэтому сравниваем по цифрам.
    expect(formatMoney('1290.50').replace(/\s/g, ' ')).toContain('1 290,50');
  });

  it('не теряет копейки', () => {
    expect(formatMoney('0.05')).toContain('0,05');
  });

  it('переживает нечисловое значение без падения', () => {
    expect(formatMoney('не число')).toBe('не число RUB');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-05-21T12:00:00.000Z');

  it('свежие события показывает как «только что»', () => {
    expect(formatRelative('2026-05-21T11:59:30.000Z', now)).toBe('только что');
  });

  it.each([
    ['2026-05-21T11:48:00.000Z', '12 минут назад'],
    ['2026-05-21T09:00:00.000Z', '3 часа назад'],
    ['2026-05-16T12:00:00.000Z', '5 дней назад'],
  ])('описывает давность для %s', (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });

  // numeric: 'auto' даёт естественные формулировки вместо «1 день назад».
  it('называет вчерашний день словом', () => {
    expect(formatRelative('2026-05-20T12:00:00.000Z', now)).toBe('вчера');
  });
});

describe('formatDateTime', () => {
  it('выводит дату и время', () => {
    expect(formatDateTime('2026-05-21T09:30:00.000Z')).toMatch(/^\d{2}\.\d{2}\.\d{4}/);
  });
});

describe('formatPhone', () => {
  it('заменяет отсутствующий телефон прочерком', () => {
    expect(formatPhone(null)).toBe('—');
    expect(formatPhone('+7 900 000-00-00')).toBe('+7 900 000-00-00');
  });
});
