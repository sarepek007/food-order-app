/**
 * Машиночитаемые коды ошибок — словарь предметной области.
 *
 * Клиент ветвится по `code`, а не по тексту сообщения: тексты меняются
 * и локализуются, коды — часть контракта.
 *
 * Здесь только сами коды: их отображение в HTTP-статусы относится
 * к транспорту и живёт в api/problem.ts. Иначе доменный слой зависел бы
 * от протокола, по которому его случилось выставить наружу.
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
  'IDEMPOTENCY_KEY_REUSED',
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

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
