/**
 * Общий контракт приложения.
 *
 * `domain/` — правила и словарь предметной области: граф статусов, бизнес-правила,
 * нормативы, коды ошибок. Не знает ни про HTTP, ни про базу.
 *
 * `api/` — то, что уходит по проводу: схемы запросов и ответов, формат ошибки,
 * событие изменения, протокол идемпотентности. Зависит от `domain/`, но не наоборот.
 */

export * from './domain/order-status.js';
export * from './domain/order-rules.js';
export * from './domain/sla.js';
export * from './domain/audit.js';
export * from './domain/search.js';
export * from './domain/error-codes.js';

export * from './api/problem.js';
export * from './api/schemas.js';
export * from './api/idempotency.js';
export * from './api/order-events.js';
