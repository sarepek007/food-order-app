/**
 * Нормативы времени на статус.
 *
 * Основная работа операционной команды — искать залипшие заказы, а не листать
 * список. «Изменён 40 минут назад» об этом не говорит: важно, что заказ висит
 * в `preparing` 40 минут при норме 25.
 *
 * Значения — ориентир по умолчанию; окончательные задаются конфигурацией,
 * потому что зависят от города, кухни и времени суток.
 */
import type { OrderStatus } from './order-status.js';

/** Норматив на статус в секундах. null — статус терминальный, ждать нечего. */
export const DEFAULT_STATUS_SLA_SECONDS: Readonly<Record<OrderStatus, number | null>> =
  Object.freeze({
    new: 5 * 60,
    accepted: 10 * 60,
    preparing: 25 * 60,
    ready: 15 * 60,
    picked_up: 45 * 60,
    delivered: null,
    cancelled: null,
  });

export type StatusSlaMap = Readonly<Record<OrderStatus, number | null>>;

/**
 * Состояние срока: `none` — норматива нет, `ok` — в пределах,
 * `warning` — норматив почти исчерпан, `overdue` — превышен.
 */
export const SLA_STATES = ['none', 'ok', 'warning', 'overdue'] as const;
export type SlaState = (typeof SLA_STATES)[number];

/** Доля норматива, после которой заказ показывается как «скоро просрочится». */
export const SLA_WARNING_RATIO = 0.8;

export interface SlaInput {
  status: OrderStatus;
  secondsInStatus: number;
  sla?: StatusSlaMap;
  warningRatio?: number;
}

export function slaLimitFor(status: OrderStatus, sla: StatusSlaMap = DEFAULT_STATUS_SLA_SECONDS): number | null {
  return sla[status];
}

export function slaStateFor({
  status,
  secondsInStatus,
  sla = DEFAULT_STATUS_SLA_SECONDS,
  warningRatio = SLA_WARNING_RATIO,
}: SlaInput): SlaState {
  const limit = slaLimitFor(status, sla);
  if (limit === null) {
    return 'none';
  }

  // Отрицательное время означает рассинхрон часов, а не выполнение норматива.
  const elapsed = Math.max(0, secondsInStatus);

  if (elapsed > limit) return 'overdue';
  if (elapsed >= limit * warningRatio) return 'warning';
  return 'ok';
}

export function isOverdue(input: SlaInput): boolean {
  return slaStateFor(input) === 'overdue';
}

/** Сколько секунд осталось до нарушения норматива. Отрицательное — на столько просрочен. */
export function secondsToDeadline(input: SlaInput): number | null {
  const limit = slaLimitFor(input.status, input.sla ?? DEFAULT_STATUS_SLA_SECONDS);
  return limit === null ? null : limit - Math.max(0, input.secondsInStatus);
}

export const SLA_STATE_LABELS: Readonly<Record<SlaState, string>> = Object.freeze({
  none: 'без норматива',
  ok: 'в пределах норматива',
  warning: 'скоро просрочится',
  overdue: 'просрочен',
});

/** «40 мин», «2 ч 15 мин», «3 дн» — компактная длительность для таблицы. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));

  if (seconds < 60) return 'меньше минуты';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} дн` : `${days} дн ${restHours} ч`;
}
