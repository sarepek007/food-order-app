/**
 * Чистые доменные правила: ни БД, ни HTTP. Один и тот же модуль использует
 * сервисный слой (для отклонения операции) и UI (для скрытия недоступных действий).
 */
import type { ErrorCode } from './errors.js';
import {
  allowedTransitions,
  canTransition,
  isCancellable,
  isTerminal,
  occupiesCourierSlot,
  orderStatusLabel,
  requiresCourier,
  type OrderStatus,
} from './order-status.js';

/** Сколько заказов в статусах ready/picked_up может вести один курьер. */
export const DEFAULT_COURIER_ACTIVE_LIMIT = 3;

export interface RuleViolation {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type RuleResult = { ok: true } | { ok: false; violation: RuleViolation };

const OK: RuleResult = { ok: true };

function fail(code: ErrorCode, message: string, details?: Record<string, unknown>): RuleResult {
  return { ok: false, violation: details ? { code, message, details } : { code, message } };
}

/**
 * Переход начинает занимать слот курьера, если заказ входит в ready/picked_up
 * из статуса, который слот не занимал.
 */
export function startsOccupyingCourierSlot(from: OrderStatus, to: OrderStatus): boolean {
  return !occupiesCourierSlot(from) && occupiesCourierSlot(to);
}

export interface StatusTransitionInput {
  currentStatus: OrderStatus;
  requestedStatus: OrderStatus;
  hasCourier: boolean;
}

export function checkStatusTransition({
  currentStatus,
  requestedStatus,
  hasCourier,
}: StatusTransitionInput): RuleResult {
  if (isTerminal(currentStatus)) {
    return fail(
      'ORDER_TERMINAL',
      `Заказ в статусе «${orderStatusLabel(currentStatus)}» изменить нельзя.`,
      { currentStatus },
    );
  }

  if (currentStatus === requestedStatus) {
    return fail(
      'ORDER_INVALID_TRANSITION',
      `Заказ уже находится в статусе «${orderStatusLabel(requestedStatus)}».`,
      {
        currentStatus,
        requestedStatus,
        allowedStatuses: [...allowedTransitions(currentStatus)],
      },
    );
  }

  if (!canTransition(currentStatus, requestedStatus)) {
    const allowed = allowedTransitions(currentStatus);
    const allowedText =
      allowed.length > 0 ? allowed.map((s) => `«${orderStatusLabel(s)}»`).join(', ') : 'нет';
    return fail(
      'ORDER_INVALID_TRANSITION',
      `Из статуса «${orderStatusLabel(currentStatus)}» нельзя перейти в «${orderStatusLabel(
        requestedStatus,
      )}». Допустимые переходы: ${allowedText}.`,
      {
        currentStatus,
        requestedStatus,
        allowedStatuses: [...allowed],
      },
    );
  }

  if (requiresCourier(requestedStatus) && !hasCourier) {
    return fail(
      'ORDER_COURIER_REQUIRED',
      `Перед переводом в статус «${orderStatusLabel(
        requestedStatus,
      )}» нужно назначить курьера.`,
      { requestedStatus },
    );
  }

  return OK;
}

export interface CancellationInput {
  currentStatus: OrderStatus;
}

export function checkCancellation({ currentStatus }: CancellationInput): RuleResult {
  if (isTerminal(currentStatus)) {
    return fail(
      'ORDER_TERMINAL',
      currentStatus === 'cancelled'
        ? 'Заказ уже отменён.'
        : 'Доставленный заказ отменить нельзя.',
      { currentStatus },
    );
  }

  if (!isCancellable(currentStatus)) {
    return fail(
      'ORDER_NOT_CANCELLABLE',
      `Заказ в статусе «${orderStatusLabel(
        currentStatus,
      )}» отменить нельзя: он уже у курьера.`,
      { currentStatus },
    );
  }

  return OK;
}

export interface CourierCapacityInput {
  courierId: string;
  courierName: string;
  activeCount: number;
  activeOrderIds: string[];
  limit?: number;
}

export function checkCourierCapacity({
  courierId,
  courierName,
  activeCount,
  activeOrderIds,
  limit = DEFAULT_COURIER_ACTIVE_LIMIT,
}: CourierCapacityInput): RuleResult {
  if (activeCount >= limit) {
    return fail(
      'COURIER_CAPACITY_EXCEEDED',
      `Курьер ${courierName} уже везёт ${activeCount} ${pluralOrders(
        activeCount,
      )} — это максимум (${limit}).`,
      { courierId, courierName, activeCount, limit, activeOrderIds },
    );
  }
  return OK;
}

export interface CourierAssignmentInput {
  orderStatus: OrderStatus;
  courierIsActive: boolean;
  courierName: string;
}

export function checkCourierAssignment({
  orderStatus,
  courierIsActive,
  courierName,
}: CourierAssignmentInput): RuleResult {
  if (isTerminal(orderStatus)) {
    return fail(
      'ORDER_TERMINAL',
      `Заказ в статусе «${orderStatusLabel(orderStatus)}» изменить нельзя.`,
      { currentStatus: orderStatus },
    );
  }

  if (!courierIsActive) {
    return fail('COURIER_INACTIVE', `Курьер ${courierName} неактивен и не может брать заказы.`);
  }

  return OK;
}

export interface CourierUnassignmentInput {
  orderStatus: OrderStatus;
  hasCourier: boolean;
}

export function checkCourierUnassignment({
  orderStatus,
  hasCourier,
}: CourierUnassignmentInput): RuleResult {
  if (isTerminal(orderStatus)) {
    return fail(
      'ORDER_TERMINAL',
      `Заказ в статусе «${orderStatusLabel(orderStatus)}» изменить нельзя.`,
      { currentStatus: orderStatus },
    );
  }

  if (!hasCourier) {
    return fail('ORDER_COURIER_NOT_ASSIGNED', 'У заказа нет назначенного курьера.');
  }

  if (requiresCourier(orderStatus)) {
    return fail(
      'ORDER_COURIER_REQUIRED',
      `У заказа в статусе «${orderStatusLabel(
        orderStatus,
      )}» должен быть курьер — его можно заменить, но не снять.`,
      { currentStatus: orderStatus },
    );
  }

  return OK;
}

function pluralOrders(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'заказ';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'заказа';
  return 'заказов';
}
