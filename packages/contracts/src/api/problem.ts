/**
 * HTTP-представление ошибки: формат RFC 9457 `application/problem+json`
 * и отображение доменных кодов в статусы ответа.
 */
import { isErrorCode, type ErrorCode } from '../domain/error-codes.js';

/** HTTP-статус, соответствующий каждому доменному коду. */
export const ERROR_CODE_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION_FAILED: 400,
  ORDER_NOT_FOUND: 404,
  RESTAURANT_NOT_FOUND: 404,
  COURIER_NOT_FOUND: 404,
  ORDER_INVALID_TRANSITION: 409,
  ORDER_NOT_CANCELLABLE: 409,
  ORDER_TERMINAL: 409,
  ORDER_VERSION_CONFLICT: 409,
  COURIER_CAPACITY_EXCEEDED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  ORDER_COURIER_REQUIRED: 422,
  COURIER_INACTIVE: 422,
  ORDER_COURIER_NOT_ASSIGNED: 422,
  RESTAURANT_INACTIVE: 422,
  PRECONDITION_REQUIRED: 428,
  INTERNAL_ERROR: 500,
});

/**
 * Тело ошибки в формате RFC 9457 (`application/problem+json`),
 * расширенное полями `code` и `details`.
 */
export interface ProblemDetails<TDetails = unknown> {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ErrorCode;
  instance?: string;
  requestId?: string;
  details?: TDetails;
}

/** Пофайловая раскладка ошибок валидации: путь до поля → сообщения. */
export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationErrorDetails {
  issues: ValidationIssue[];
}

export interface InvalidTransitionDetails {
  currentStatus: string;
  requestedStatus: string;
  allowedStatuses: string[];
}

export interface CourierCapacityDetails {
  courierId: string;
  courierName: string;
  activeCount: number;
  limit: number;
  activeOrderIds: string[];
}

export interface IdempotencyReuseDetails {
  key: string;
  originalRequest: string;
}

export interface VersionConflictDetails<TOrder = unknown> {
  expectedVersion: number;
  actualVersion: number;
  changedFields: string[];
  current: TOrder;
}

export const PROBLEM_TYPE_BASE = 'https://food-order-app.local/problems';

export function problemTypeFor(code: ErrorCode): string {
  return `${PROBLEM_TYPE_BASE}/${code.toLowerCase().replaceAll('_', '-')}`;
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['status'] === 'number' &&
    typeof candidate['title'] === 'string' &&
    isErrorCode(candidate['code'])
  );
}
