import type { FastifyRequest } from 'fastify';
import { DomainError } from '../errors/domain-error.js';

/**
 * ETag заказа — его версия. Слабых валидаторов не используем: сравнение
 * строгое, потому что любое изменение заказа меняет версию.
 */
export function etagOf(version: number): string {
  return `"${version}"`;
}

export interface ExpectedVersion {
  /** Конкретная версия из If-Match или из тела запроса. */
  value: number | null;
  /** If-Match: * — «применить поверх текущего состояния». */
  force: boolean;
}

function parseIfMatch(header: string): ExpectedVersion | null {
  const raw = header.trim();
  if (raw === '*') {
    return { value: null, force: true };
  }

  // Допускаем и W/"7", и "7", и 7 — клиенты и прокси ведут себя по-разному.
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(raw);
  if (!match) {
    return null;
  }

  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version > 0 ? { value: version, force: false } : null;
}

/**
 * Версия, на которой клиент строил своё решение. Берётся из If-Match,
 * при его отсутствии — из поля version в теле. Если нет ни того, ни другого,
 * запрос отклоняется: молчаливая перезапись чужих изменений недопустима.
 */
export function resolveExpectedVersion(
  request: FastifyRequest,
  bodyVersion?: number | undefined,
): ExpectedVersion {
  const header = request.headers['if-match'];

  if (typeof header === 'string' && header.length > 0) {
    const parsed = parseIfMatch(header);
    if (!parsed) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `Некорректный заголовок If-Match: «${header}». Ожидается версия заказа, например "7", либо *.`,
      );
    }
    return parsed;
  }

  if (bodyVersion !== undefined) {
    return { value: bodyVersion, force: false };
  }

  throw new DomainError(
    'PRECONDITION_REQUIRED',
    'Укажите версию заказа в заголовке If-Match (например, If-Match: "7") ' +
      'или в поле version — иначе изменение может незаметно перезаписать чужое.',
  );
}
