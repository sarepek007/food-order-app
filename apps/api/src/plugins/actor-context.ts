import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Кто выполняет действие. Аутентификации нет — значение приходит заголовком. */
    actor: string;
  }
}

export const ACTOR_HEADER = 'x-actor';
export const DEFAULT_ACTOR = 'operator';
const MAX_ACTOR_LENGTH = 80;

/**
 * Значения HTTP-заголовков по RFC 9110 — байты latin-1, и Node отдаёт их
 * именно так. Кириллица, отправленная как UTF-8, приезжает мусором
 * («Анна» → «ÐÐ½Ð½Ð°»), а журнал изменений обязан хранить читаемое имя.
 *
 * Поддерживаются оба корректных способа передать не-ASCII:
 * процентное кодирование и сырые UTF-8 байты.
 */
/** Есть ли в строке кодовая точка выше указанной границы. */
function hasCodePointAbove(value: string, boundary: number): boolean {
  for (const char of value) {
    if ((char.codePointAt(0) ?? 0) > boundary) {
      return true;
    }
  }
  return false;
}

export function decodeHeaderValue(raw: string): string {
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      return decodeURIComponent(raw);
    } catch {
      // Некорректная последовательность — обрабатываем значение как обычный текст.
    }
  }

  // Символы вне latin-1 означают, что строка уже декодирована: чинить нечего.
  if (hasCodePointAbove(raw, 0xff)) {
    return raw;
  }

  // Чистый ASCII тоже не требует восстановления.
  if (!hasCodePointAbove(raw, 0x7f)) {
    return raw;
  }

  const repaired = Buffer.from(raw, 'latin1').toString('utf8');
  // U+FFFD означает, что байты не были UTF-8 — значит, это настоящий latin-1.
  return repaired.includes('\uFFFD') ? raw : repaired;
}

export function normalizeActor(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return DEFAULT_ACTOR;

  const decoded = decodeHeaderValue(value).trim();
  return decoded.length > 0 ? decoded.slice(0, MAX_ACTOR_LENGTH) : DEFAULT_ACTOR;
}

/**
 * Аутентификация в задаче не требуется, но журнал изменений обязан хранить
 * автора. Имя берётся из заголовка X-Actor.
 */
export function registerActorContext(app: FastifyInstance): void {
  app.decorateRequest('actor', DEFAULT_ACTOR);

  app.addHook('onRequest', async (request) => {
    request.actor = normalizeActor(request.headers[ACTOR_HEADER]);
  });
}
