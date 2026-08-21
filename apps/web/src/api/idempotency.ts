import { canonicalizeRequestBody } from '@food/contracts';

/**
 * Ключ повтора выводится из самого действия, а не генерируется случайно.
 *
 * Благодаря этому двойной клик по кнопке даёт один и тот же ключ — сервер
 * распознаёт второй запрос как повтор и не применяет изменение дважды.
 * Осознанно новое действие всегда отличается версией заказа или содержимым,
 * поэтому получает новый ключ.
 */
export function idempotencyKeyFor(orderId: string, version: string, action: unknown): string {
  const canonical = `${orderId}:${version}:${canonicalizeRequestBody(action)}`;
  return `web-${hash64(canonical)}-${orderId.slice(0, 8)}`;
}

/**
 * FNV-1a на двух 32-битных накопителях: нужен синхронный отпечаток,
 * а crypto.subtle асинхронный и требует защищённого контекста.
 */
function hash64(value: string): string {
  let high = 0x811c9dc5;
  let low = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    high ^= code;
    high = Math.imul(high, 0x01000193) >>> 0;
    low ^= code + index;
    low = Math.imul(low, 0x01000193) >>> 0;
  }

  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`;
}
