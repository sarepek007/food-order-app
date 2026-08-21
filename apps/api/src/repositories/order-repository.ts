import { type OrderStatus, isSearchable, normalizeSearchQuery, type ListOrdersQuery } from '@food/contracts';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { couriers, orders, restaurants, type OrderRow } from '../db/schema.js';

export interface OrderWithRefs {
  order: OrderRow;
  restaurant: { id: string; name: string; address: string };
  courier: { id: string; name: string } | null;
}

const refSelection = {
  order: orders,
  restaurantId: restaurants.id,
  restaurantName: restaurants.name,
  restaurantAddress: restaurants.address,
  courierId: couriers.id,
  courierName: couriers.name,
} as const;

type RefRow = {
  order: OrderRow;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;
  courierId: string | null;
  courierName: string | null;
};

function toOrderWithRefs(row: RefRow): OrderWithRefs {
  return {
    order: row.order,
    restaurant: { id: row.restaurantId, name: row.restaurantName, address: row.restaurantAddress },
    courier: row.courierId && row.courierName ? { id: row.courierId, name: row.courierName } : null,
  };
}

export async function findOrderWithRefs(db: Database, id: string): Promise<OrderWithRefs | undefined> {
  const rows = await db
    .select(refSelection)
    .from(orders)
    .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
    .leftJoin(couriers, eq(orders.courierId, couriers.id))
    .where(eq(orders.id, id))
    .limit(1);

  const row = rows[0];
  return row ? toOrderWithRefs(row) : undefined;
}

export async function findOrderRow(db: Database, id: string): Promise<OrderRow | undefined> {
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return rows[0];
}

/* ------------------------------------------------------------------ */
/* Список заказов                                                      */
/* ------------------------------------------------------------------ */

/**
 * Ранг совпадения адреса. word_similarity ищет запрос как фрагмент внутри
 * адреса («ленина» в «ул ленина д 5»), обычная similarity сравнивает строки
 * целиком и лучше отрабатывает полный адрес с опечатками. Берём максимум.
 */
function relevanceExpression(normalizedQuery: string): SQL<number> {
  return sql<number>`GREATEST(
    word_similarity(${normalizedQuery}, ${orders.deliveryAddressNormalized}),
    similarity(${normalizedQuery}, ${orders.deliveryAddressNormalized})
  )`;
}

function searchCondition(normalizedQuery: string): SQL {
  // `<%` и `%` работают через GIN-индекс; LIKE добавлен для коротких запросов
  // вроде «12», у которых триграммного сходства не хватает.
  return sql`(
    ${normalizedQuery} <% ${orders.deliveryAddressNormalized}
    OR ${normalizedQuery} % ${orders.deliveryAddressNormalized}
    OR ${orders.deliveryAddressNormalized} LIKE ${'%' + normalizedQuery + '%'}
  )`;
}

function buildFilters(query: ListOrdersQuery): SQL[] {
  const conditions: SQL[] = [];

  if (query.status && query.status.length > 0) {
    conditions.push(inArray(orders.status, query.status as OrderStatus[]));
  }
  if (query.restaurantId && query.restaurantId.length > 0) {
    conditions.push(inArray(orders.restaurantId, query.restaurantId));
  }
  if (query.courierId && query.courierId.length > 0) {
    conditions.push(inArray(orders.courierId, query.courierId));
  }
  if (query.unassigned === true) {
    conditions.push(isNull(orders.courierId));
  }
  if (query.unassigned === false) {
    conditions.push(sql`${orders.courierId} IS NOT NULL`);
  }
  if (query.minAmount !== undefined) {
    conditions.push(gte(orders.totalAmount, String(query.minAmount)));
  }
  if (query.maxAmount !== undefined) {
    conditions.push(lte(orders.totalAmount, String(query.maxAmount)));
  }
  if (query.createdFrom) {
    conditions.push(gte(orders.createdAt, query.createdFrom));
  }
  if (query.createdTo) {
    conditions.push(lte(orders.createdAt, query.createdTo));
  }
  if (isSearchable(query.q)) {
    conditions.push(searchCondition(normalizeSearchQuery(query.q!)));
  }

  return conditions;
}

function buildOrderBy(query: ListOrdersQuery): SQL[] {
  const direction = query.order === 'asc' ? asc : desc;
  const tieBreaker = direction(orders.id);

  switch (query.sort) {
    case 'updatedAt':
      return [direction(orders.updatedAt), tieBreaker];
    case 'totalAmount':
      return [direction(orders.totalAmount), tieBreaker];
    case 'status':
      return [direction(orders.status), direction(orders.createdAt), tieBreaker];
    case 'relevance': {
      if (!isSearchable(query.q)) {
        // Релевантность без поискового запроса не определена — падать не за что,
        // молча откатываемся к дате создания.
        return [direction(orders.createdAt), tieBreaker];
      }
      return [desc(relevanceExpression(normalizeSearchQuery(query.q!))), desc(orders.createdAt), tieBreaker];
    }
    case 'createdAt':
    default:
      return [direction(orders.createdAt), tieBreaker];
  }
}

export interface ListOrdersResult {
  items: OrderWithRefs[];
  total: number;
}

export async function listOrders(db: Database, query: ListOrdersQuery): Promise<ListOrdersResult> {
  const conditions = buildFilters(query);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ value: total = 0 } = { value: 0 }] = await db
    .select({ value: count() })
    .from(orders)
    .where(where);

  if (total === 0) {
    return { items: [], total: 0 };
  }

  const rows = await db
    .select(refSelection)
    .from(orders)
    .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
    .leftJoin(couriers, eq(orders.courierId, couriers.id))
    .where(where)
    .orderBy(...buildOrderBy(query))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return { items: rows.map(toOrderWithRefs), total };
}

/* ------------------------------------------------------------------ */
/* Изменение                                                           */
/* ------------------------------------------------------------------ */

export interface InsertOrderData {
  customerName: string;
  customerPhone?: string | undefined;
  restaurantId: string;
  courierId?: string | undefined;
  deliveryAddress: string;
  totalAmount: string;
  currency: string;
}

export async function insertOrder(db: Database, data: InsertOrderData): Promise<OrderRow> {
  const [row] = await db
    .insert(orders)
    .values({
      customerName: data.customerName,
      customerPhone: data.customerPhone ?? null,
      restaurantId: data.restaurantId,
      courierId: data.courierId ?? null,
      deliveryAddress: data.deliveryAddress,
      totalAmount: data.totalAmount,
      currency: data.currency,
    })
    .returning();

  return row!;
}

export interface OrderPatch {
  status?: OrderStatus;
  courierId?: string | null;
  cancelReason?: string | null;
}

/**
 * Обновление с проверкой версии. Возвращает undefined, если версия не совпала
 * (или заказа нет) — это и есть сигнал конфликта для сервисного слоя.
 * Версию и updated_at выставляет триггер БД, здесь они не трогаются.
 */
export async function updateOrderWithVersion(
  db: Database,
  id: string,
  expectedVersion: number,
  patch: OrderPatch,
): Promise<OrderRow | undefined> {
  const values: Record<string, unknown> = {};
  if (patch.status !== undefined) values['status'] = patch.status;
  if (patch.courierId !== undefined) values['courierId'] = patch.courierId;
  if (patch.cancelReason !== undefined) values['cancelReason'] = patch.cancelReason;

  const [row] = await db
    .update(orders)
    .set(values)
    .where(and(eq(orders.id, id), eq(orders.version, expectedVersion)))
    .returning();

  return row;
}

/* ------------------------------------------------------------------ */
/* Загрузка курьера                                                    */
/* ------------------------------------------------------------------ */

/**
 * Транзакционный advisory-лок по курьеру.
 *
 * Проверка «меньше трёх активных» и последующая запись обязаны быть атомарны
 * относительно других назначений тому же курьеру. Блокировать нечего: строки
 * будущего заказа ещё не связаны с курьером, поэтому SELECT ... FOR UPDATE
 * гонку не закрывает. Лок снимается автоматически на COMMIT/ROLLBACK.
 */
export async function lockCourier(db: Database, courierId: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'courier:' + courierId}, 0))`);
}

export interface CourierLoad {
  activeCount: number;
  activeOrderIds: string[];
}

export async function getCourierLoad(db: Database, courierId: string): Promise<CourierLoad> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.courierId, courierId),
        inArray(orders.status, ['ready', 'picked_up'] satisfies OrderStatus[]),
      ),
    );

  return { activeCount: rows.length, activeOrderIds: rows.map((row) => row.id) };
}
