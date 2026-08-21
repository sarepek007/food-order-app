/**
 * Идемпотентность мутаций.
 *
 * При нестабильной сети клиент не знает, дошёл ли запрос: ответ мог потеряться
 * уже после применения изменения. Повтор без защиты создаёт второй переход
 * и вторую запись в журнале — журнал перестаёт отражать реальность.
 */

/** Заголовок, которым клиент помечает повторяемый запрос. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Заголовок ответа: изменение уже было применено, это воспроизведение. */
export const IDEMPOTENCY_REPLAYED_HEADER = 'idempotency-replayed';

export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** Сколько хранится результат: дольше любого разумного ретрая, короче вечности. */
export const IDEMPOTENCY_TTL_HOURS = 24;

const KEY_PATTERN = /^[\x21-\x7e]+$/;

/**
 * Ключ должен быть печатаемым ASCII: значение попадает в заголовок,
 * а не-ASCII в заголовках приезжает искажённым.
 */
export function isValidIdempotencyKey(value: string): boolean {
  return (
    value.length >= IDEMPOTENCY_KEY_MIN_LENGTH &&
    value.length <= IDEMPOTENCY_KEY_MAX_LENGTH &&
    KEY_PATTERN.test(value)
  );
}

/**
 * Канонический вид тела запроса для отпечатка: ключи объектов сортируются,
 * иначе `{"a":1,"b":2}` и `{"b":2,"a":1}` дали бы разные отпечатки
 * при одинаковом смысле.
 */
export function canonicalizeRequestBody(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}
