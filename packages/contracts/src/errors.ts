/**
 * Машиночитаемые коды ошибок. Клиент ветвится по `code`, а не по тексту
 * сообщения: тексты меняются и локализуются, коды — часть контракта.
 */
export const ERROR_CODES = [
  // 400 — запрос не проходит схему
  'VALIDATION_FAILED',
  // 404 — сущность не существует
  'ORDER_NOT_FOUND',
  'RESTAURANT_NOT_FOUND',
  'COURIER_NOT_FOUND',
  // 409 — конфликт с текущим состоянием ресурса
  'ORDER_INVALID_TRANSITION',
  'ORDER_NOT_CANCELLABLE',
  'ORDER_TERMINAL',
  'ORDER_VERSION_CONFLICT',
  'COURIER_CAPACITY_EXCEEDED',
  // 422 — запрос валиден синтаксически, но неисполним по бизнес-смыслу
  'ORDER_COURIER_REQUIRED',
  'COURIER_INACTIVE',
  'ORDER_COURIER_NOT_ASSIGNED',
  'RESTAURANT_INACTIVE',
  // 428 — не передан If-Match
  'PRECONDITION_REQUIRED',
  // 5xx
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

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

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
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
