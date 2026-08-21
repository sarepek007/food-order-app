import { and, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  orderId: string | null;
  actor: string;
  createdAt: Date;
}

export interface SaveIdempotencyInput {
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  orderId?: string | null;
  actor: string;
  ttlHours: number;
}

export async function findIdempotencyRecord(
  db: Database,
  key: string,
): Promise<IdempotencyRecord | undefined> {
  const rows = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), sql`${idempotencyKeys.expiresAt} > now()`))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  return {
    key: row.key,
    requestHash: row.requestHash,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    orderId: row.orderId,
    actor: row.actor,
    createdAt: row.createdAt,
  };
}

/**
 * Запись идёт в транзакции самой мутации. Нарушение уникальности означает,
 * что параллельный запрос с тем же ключом успел раньше: наша транзакция
 * откатывается целиком, и повтор возвращает уже сохранённый результат.
 */
export async function saveIdempotencyRecord(
  db: Database,
  input: SaveIdempotencyInput,
): Promise<void> {
  await db.insert(idempotencyKeys).values({
    key: input.key,
    requestHash: input.requestHash,
    responseStatus: input.responseStatus,
    responseBody: input.responseBody,
    orderId: input.orderId ?? null,
    actor: input.actor,
    expiresAt: sql`now() + make_interval(hours => ${input.ttlHours})`,
  });
}

/** Уборка просроченных ключей. Вызывается по расписанию, а не на горячем пути. */
export async function deleteExpiredIdempotencyKeys(db: Database): Promise<number> {
  const deleted = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, sql`now()`))
    .returning({ key: idempotencyKeys.key });

  return deleted.length;
}
