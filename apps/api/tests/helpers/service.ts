import { OrderService, type ActorContext } from '../../src/services/order-service.js';
import type { DbPool } from '../../src/db/pool.js';

export const TEST_COURIER_LIMIT = 3;

export function createTestService(pool: DbPool): OrderService {
  return new OrderService(pool, {
    courierActiveLimit: TEST_COURIER_LIMIT,
    searchSimilarityThreshold: 0.5,
  });
}

export function actor(name = 'tester'): ActorContext {
  return { actor: name };
}

/** Возвращает DomainError-подобный объект или падает, если ошибки не было. */
export async function captureError(fn: () => Promise<unknown>): Promise<{
  code: string;
  message: string;
  httpStatus: number;
  details: Record<string, unknown> | undefined;
}> {
  try {
    await fn();
  } catch (error) {
    const domain = error as { code?: string; message: string; httpStatus?: number; details?: Record<string, unknown> };
    if (!domain.code) throw error;
    return {
      code: domain.code,
      message: domain.message,
      httpStatus: domain.httpStatus!,
      details: domain.details,
    };
  }
  throw new Error('ожидалась DomainError, но вызов завершился успешно');
}
