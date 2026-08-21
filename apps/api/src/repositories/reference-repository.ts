import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { couriers, orders, restaurants, type CourierRow, type RestaurantRow } from '../db/schema.js';

export async function listRestaurants(db: Database): Promise<RestaurantRow[]> {
  return db.select().from(restaurants).orderBy(asc(restaurants.name));
}

export async function findRestaurantById(
  db: Database,
  id: string,
): Promise<RestaurantRow | undefined> {
  const rows = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
  return rows[0];
}

export async function findCourierById(db: Database, id: string): Promise<CourierRow | undefined> {
  const rows = await db.select().from(couriers).where(eq(couriers.id, id)).limit(1);
  return rows[0];
}

export interface CourierWithLoad extends CourierRow {
  activeOrdersCount: number;
}

/**
 * Курьеры вместе с текущей загрузкой. Подсчёт — коррелированным подзапросом
 * по частичному индексу idx_orders_active_by_courier: справочник маленький,
 * а UI показывает «2/3» рядом с каждым именем.
 */
export async function listCouriersWithLoad(db: Database): Promise<CourierWithLoad[]> {
  const rows = await db
    .select({
      courier: couriers,
      activeOrdersCount: sql<number>`(
        SELECT count(*)::int FROM ${orders}
        WHERE ${orders.courierId} = ${couriers.id}
          AND ${orders.status} IN ('ready', 'picked_up')
      )`,
    })
    .from(couriers)
    .orderBy(asc(couriers.name));

  return rows.map((row) => ({ ...row.courier, activeOrdersCount: row.activeOrdersCount }));
}

export async function findCouriersByIds(db: Database, ids: string[]): Promise<CourierRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(couriers).where(inArray(couriers.id, ids));
}
