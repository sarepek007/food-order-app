/** Форматирование для интерфейса. Суммы приходят строкой — арифметики над ними нет (ADR 0002). */

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 2,
});

export function formatMoney(amount: string, currency = 'RUB'): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  return currency === 'RUB'
    ? moneyFormatter.format(value)
    : new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(value);
}

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

const relativeFormatter = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/** «12 минут назад» — оператору важна свежесть, а не абсолютная метка. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const absolute = Math.abs(diff);

  if (absolute < 60_000) return 'только что';

  for (const [unit, ms] of UNITS) {
    if (absolute >= ms) {
      return relativeFormatter.format(Math.round(diff / ms), unit);
    }
  }

  return 'только что';
}

export function formatPhone(phone: string | null): string {
  return phone ?? '—';
}
