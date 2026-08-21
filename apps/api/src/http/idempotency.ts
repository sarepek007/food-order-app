import { createHash } from 'node:crypto';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  canonicalizeRequestBody,
  isValidIdempotencyKey,
} from '@food/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '../errors/domain-error.js';
import type { IdempotencyContext } from '../services/order-service.js';

/**
 * Отпечаток запроса: метод, конкретный путь и канонизированное тело.
 * Путь входит в отпечаток, поэтому один ключ, использованный для двух разных
 * заказов, будет распознан как ошибка клиента, а не как повтор.
 */
function requestHash(request: FastifyRequest): string {
  const body = canonicalizeRequestBody(request.body ?? null);
  return createHash('sha256')
    .update(`${request.method}:${request.url}:${body}`)
    .digest('hex');
}

/**
 * Контекст повторяемого запроса. Возвращает undefined, если клиент
 * не прислал ключ: идемпотентность включается по инициативе клиента,
 * потому что только он знает, повтор это или новое действие.
 */
export function idempotencyFrom(
  request: FastifyRequest,
  reply: FastifyReply,
): IdempotencyContext | undefined {
  const header = request.headers[IDEMPOTENCY_KEY_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  const key = raw?.trim();

  if (!key) {
    return undefined;
  }

  if (!isValidIdempotencyKey(key)) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `Некорректный ${IDEMPOTENCY_KEY_HEADER}: ожидается печатаемая ASCII-строка длиной 8–255 символов.`,
    );
  }

  return {
    key,
    requestHash: requestHash(request),
    onReplay: () => {
      void reply.header(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    },
  };
}
