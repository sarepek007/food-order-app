import {
  checkCancellation,
  checkCourierAssignment,
  checkCourierCapacity,
  checkCourierUnassignment,
  checkStatusTransition,
  occupiesCourierSlot,
  orderStatusLabel,
  startsOccupyingCourierSlot,
  type AuditEntry,
  type AuditQuery,
  type CancelOrderInput,
  type ChangeStatusInput,
  type Courier,
  type CreateOrderInput,
  type ListOrdersQuery,
  type OrderDetails,
  type OrderListItem,
  type Paginated,
  type Restaurant,
} from '@food/contracts';
import { sql } from 'drizzle-orm';
import { createDatabase, createTransactionalDatabase, type Database } from '../db/client.js';
import type { DbPool } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import type { OrderRow } from '../db/schema.js';
import { DomainError, assertRule } from '../errors/domain-error.js';
import {
  appendAudit,
  listAuditForOrder,
  listAuditSinceVersion,
  type AuditRecord,
} from '../repositories/audit-repository.js';
import {
  findOrderRow,
  findOrderWithRefs,
  getCourierLoad,
  insertOrder,
  listOrders,
  lockCourier,
  updateOrderWithVersion,
  type OrderPatch,
} from '../repositories/order-repository.js';
import {
  findCourierById,
  findRestaurantById,
  listCouriersWithLoad,
  listRestaurants,
} from '../repositories/reference-repository.js';
import { paginate, toAuditEntry, toCourier, toOrderDetails, toOrderListItem, toRestaurant } from './mappers.js';

export interface OrderServiceOptions {
  courierActiveLimit: number;
  searchSimilarityThreshold: number;
}

/** Кто выполняет действие. Аутентификации нет — значение приходит заголовком X-Actor. */
export interface ActorContext {
  actor: string;
}

export class OrderService {
  private readonly db: Database;

  constructor(
    private readonly pool: DbPool,
    private readonly options: OrderServiceOptions,
  ) {
    this.db = createDatabase(pool);
  }

  /* ---------------------------------------------------------------- */
  /* Чтение                                                            */
  /* ---------------------------------------------------------------- */

  async list(query: ListOrdersQuery): Promise<Paginated<OrderListItem>> {
    // Порог триграммного сходства — сессионная настройка, поэтому запрос идёт
    // в транзакции: SET LOCAL действует только на текущее соединение.
    const result = await withTransaction(this.pool, async (client) => {
      const db = createTransactionalDatabase(client);
      await this.applySimilarityThreshold(db);
      return listOrders(db, query);
    });

    return paginate(result.items.map(toOrderListItem), result.total, query.page, query.pageSize);
  }

  async getById(id: string): Promise<OrderDetails> {
    const found = await findOrderWithRefs(this.db, id);
    if (!found) {
      throw this.orderNotFound(id);
    }
    return toOrderDetails(found);
  }

  async getAudit(id: string, query: AuditQuery): Promise<Paginated<AuditEntry>> {
    const order = await findOrderRow(this.db, id);
    if (!order) {
      throw this.orderNotFound(id);
    }

    const page = await listAuditForOrder(this.db, id, query);
    return paginate(page.items.map(toAuditEntry), page.total, query.page, query.pageSize);
  }

  async listRestaurants(): Promise<Restaurant[]> {
    const rows = await listRestaurants(this.db);
    return rows.map(toRestaurant);
  }

  async listCouriers(): Promise<Courier[]> {
    const rows = await listCouriersWithLoad(this.db);
    return rows.map((row) => toCourier(row, this.options.courierActiveLimit));
  }

  /* ---------------------------------------------------------------- */
  /* Создание                                                          */
  /* ---------------------------------------------------------------- */

  async create(input: CreateOrderInput, context: ActorContext): Promise<OrderDetails> {
    return withTransaction(this.pool, async (client) => {
      const db = createTransactionalDatabase(client);

      const restaurant = await findRestaurantById(db, input.restaurantId);
      if (!restaurant) {
        throw new DomainError('RESTAURANT_NOT_FOUND', 'Ресторан не найден', {
          restaurantId: input.restaurantId,
        });
      }
      if (!restaurant.isActive) {
        throw new DomainError(
          'RESTAURANT_INACTIVE',
          `Ресторан «${restaurant.name}» неактивен и не принимает заказы.`,
        );
      }

      if (input.courierId) {
        const courier = await this.requireCourier(db, input.courierId);
        if (!courier.isActive) {
          throw new DomainError(
            'COURIER_INACTIVE',
            `Курьер ${courier.name} неактивен и не может брать заказы.`,
          );
        }
      }

      const created = await insertOrder(db, {
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        restaurantId: input.restaurantId,
        courierId: input.courierId,
        deliveryAddress: input.deliveryAddress,
        totalAmount: input.totalAmount,
        currency: input.currency,
      });

      await appendAudit(db, {
        orderId: created.id,
        action: 'ORDER_CREATED',
        actor: context.actor,
        orderVersion: created.version,
        newStatus: created.status,
        newCourierId: created.courierId,
      });

      return this.loadDetails(db, created.id);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Изменение статуса                                                 */
  /* ---------------------------------------------------------------- */

  async changeStatus(
    id: string,
    input: ChangeStatusInput,
    expectedVersion: number,
    context: ActorContext,
  ): Promise<OrderDetails> {
    return withTransaction(this.pool, async (client) => {
      const db = createTransactionalDatabase(client);
      const order = await this.requireOrderAtVersion(db, id, expectedVersion);

      assertRule(
        checkStatusTransition({
          currentStatus: order.status,
          requestedStatus: input.status,
          hasCourier: order.courierId !== null,
        }),
      );

      // Переход в ready делает заказ активным для курьера — значит, проверяем
      // лимит ровно так же, как при назначении.
      if (startsOccupyingCourierSlot(order.status, input.status) && order.courierId) {
        await this.assertCourierHasCapacity(db, order.courierId);
      }

      const updated = await this.applyPatch(db, order, expectedVersion, { status: input.status });

      await appendAudit(db, {
        orderId: id,
        action: 'STATUS_CHANGED',
        actor: context.actor,
        orderVersion: updated.version,
        oldStatus: order.status,
        newStatus: updated.status,
        comment: input.comment ?? null,
      });

      return this.loadDetails(db, id);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Курьер                                                            */
  /* ---------------------------------------------------------------- */

  async assignCourier(
    id: string,
    courierId: string,
    expectedVersion: number,
    context: ActorContext,
  ): Promise<OrderDetails> {
    return withTransaction(this.pool, async (client) => {
      const db = createTransactionalDatabase(client);
      const order = await this.requireOrderAtVersion(db, id, expectedVersion);
      const courier = await this.requireCourier(db, courierId);

      assertRule(
        checkCourierAssignment({
          orderStatus: order.status,
          courierIsActive: courier.isActive,
          courierName: courier.name,
        }),
      );

      // Повторное назначение того же курьера — не изменение: версию не двигаем
      // и журнал не засоряем.
      if (order.courierId === courierId) {
        return this.loadDetails(db, id);
      }

      // Слот занимается только заказами в ready/picked_up: назначение курьера
      // на заказ, который ещё готовится, его загрузку не увеличивает.
      if (occupiesCourierSlot(order.status)) {
        await this.assertCourierHasCapacity(db, courierId);
      }

      const updated = await this.applyPatch(db, order, expectedVersion, { courierId });

      await appendAudit(db, {
        orderId: id,
        action: order.courierId ? 'COURIER_CHANGED' : 'COURIER_ASSIGNED',
        actor: context.actor,
        orderVersion: updated.version,
        oldCourierId: order.courierId,
        newCourierId: courierId,
        oldStatus: order.status,
        newStatus: updated.status,
      });

      return this.loadDetails(db, id);
    });
  }

  async unassignCourier(
    id: string,
    expectedVersion: number,
    context: ActorContext,
  ): Promise<OrderDetails> {
    return withTransaction(this.pool, async (client) => {
      const db = createTransactionalDatabase(client);
      const order = await this.requireOrderAtVersion(db, id, expectedVersion);

      assertRule(
        checkCourierUnassignment({
          orderStatus: order.status,
          hasCourier: order.courierId !== null,
        }),
      );

      const updated = await this.applyPatch(db, order, expectedVersion, { courierId: null });

      await appendAudit(db, {
        orderId: id,
        action: 'COURIER_UNASSIGNED',
        actor: context.actor,
        orderVersion: updated.version,
        oldCourierId: order.courierId,
        oldStatus: order.status,
        newStatus: updated.status,
      });

      return this.loadDetails(db, id);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Отмена                                                            */
  /* ---------------------------------------------------------------- */

  async cancel(
    id: string,
    input: CancelOrderInput,
    expectedVersion: number,
    context: ActorContext,
  ): Promise<OrderDetails> {
    return withTransaction(this.pool, async (client) => {
      const db = createTransactionalDatabase(client);
      const order = await this.requireOrderAtVersion(db, id, expectedVersion);

      assertRule(checkCancellation({ currentStatus: order.status }));

      const updated = await this.applyPatch(db, order, expectedVersion, {
        status: 'cancelled',
        cancelReason: input.reason,
      });

      await appendAudit(db, {
        orderId: id,
        action: 'ORDER_CANCELLED',
        actor: context.actor,
        orderVersion: updated.version,
        oldStatus: order.status,
        newStatus: 'cancelled',
        comment: input.reason,
      });

      return this.loadDetails(db, id);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Внутреннее                                                        */
  /* ---------------------------------------------------------------- */

  private async applySimilarityThreshold(db: Database): Promise<void> {
    const value = this.options.searchSimilarityThreshold;
    // SET LOCAL не принимает параметры привязки, поэтому значение подставляется
    // в текст запроса. Оно уже провалидировано конфигом как число 0..1.
    const safe = Math.min(1, Math.max(0, value)).toFixed(3);
    await db.execute(sql.raw(`SET LOCAL pg_trgm.similarity_threshold = ${safe}`));
    await db.execute(sql.raw(`SET LOCAL pg_trgm.word_similarity_threshold = ${safe}`));
  }

  private orderNotFound(id: string): DomainError {
    return new DomainError('ORDER_NOT_FOUND', 'Заказ не найден', { orderId: id });
  }

  private async requireCourier(db: Database, courierId: string) {
    const courier = await findCourierById(db, courierId);
    if (!courier) {
      throw new DomainError('COURIER_NOT_FOUND', 'Курьер не найден', { courierId });
    }
    return courier;
  }

  /**
   * Читает заказ и сверяет версию до выполнения правил: так оператор получает
   * конфликт вместо непонятного отказа по бизнес-правилу, посчитанному
   * на устаревшем состоянии.
   */
  private async requireOrderAtVersion(
    db: Database,
    id: string,
    expectedVersion: number,
  ): Promise<OrderRow> {
    const order = await findOrderRow(db, id);
    if (!order) {
      throw this.orderNotFound(id);
    }
    if (order.version !== expectedVersion) {
      throw await this.versionConflict(db, id, expectedVersion, order.version);
    }
    return order;
  }

  /**
   * Единственная точка записи изменений заказа: UPDATE идёт с условием
   * по версии, поэтому гонка между чтением и записью тоже даёт конфликт.
   */
  private async applyPatch(
    db: Database,
    order: OrderRow,
    expectedVersion: number,
    patch: OrderPatch,
  ): Promise<OrderRow> {
    const updated = await updateOrderWithVersion(db, order.id, expectedVersion, patch);
    if (!updated) {
      throw await this.versionConflict(db, order.id, expectedVersion);
    }
    return updated;
  }

  private async assertCourierHasCapacity(db: Database, courierId: string): Promise<void> {
    const courier = await this.requireCourier(db, courierId);

    // Лок берётся до подсчёта: иначе два параллельных назначения увидят
    // одинаковое количество активных заказов и оба пройдут проверку.
    await lockCourier(db, courierId);
    const load = await getCourierLoad(db, courierId);

    assertRule(
      checkCourierCapacity({
        courierId,
        courierName: courier.name,
        activeCount: load.activeCount,
        activeOrderIds: load.activeOrderIds,
        limit: this.options.courierActiveLimit,
      }),
    );
  }

  private async loadDetails(db: Database, id: string): Promise<OrderDetails> {
    const found = await findOrderWithRefs(db, id);
    if (!found) {
      throw this.orderNotFound(id);
    }
    return toOrderDetails(found);
  }

  /**
   * Собирает объяснение конфликта: что именно изменилось с версии, которую
   * держал клиент. Источник — журнал, поэтому объяснение точное, а не
   * «кто-то что-то поменял».
   */
  private async versionConflict(
    db: Database,
    id: string,
    expectedVersion: number,
    knownActualVersion?: number,
  ): Promise<DomainError> {
    const current = await findOrderWithRefs(db, id);
    if (!current) {
      return this.orderNotFound(id);
    }

    const actualVersion = knownActualVersion ?? current.order.version;
    const changes = await listAuditSinceVersion(db, id, expectedVersion);
    const summaries = changes.map(describeAuditRecord).filter((text): text is string => text !== null);
    const actors = [...new Set(changes.map((record) => record.actor))];

    const detail =
      summaries.length > 0
        ? `Пока вы работали с заказом, его изменил другой пользователь${
            actors.length > 0 ? ` (${actors.join(', ')})` : ''
          }: ${summaries.join('; ')}.`
        : 'Заказ был изменён другим пользователем. Обновите данные и повторите действие.';

    return new DomainError('ORDER_VERSION_CONFLICT', detail, {
      expectedVersion,
      actualVersion,
      changedFields: changedFieldsOf(changes),
      changes: summaries,
      current: toOrderDetails(current),
    });
  }
}

function describeAuditRecord(record: AuditRecord): string | null {
  switch (record.action) {
    case 'STATUS_CHANGED':
      return `статус ${label(record.oldStatus)} → ${label(record.newStatus)}`;
    case 'COURIER_ASSIGNED':
      return `назначен курьер ${record.newCourier?.name ?? '—'}`;
    case 'COURIER_CHANGED':
      return `курьер ${record.oldCourier?.name ?? '—'} → ${record.newCourier?.name ?? '—'}`;
    case 'COURIER_UNASSIGNED':
      return `снят курьер ${record.oldCourier?.name ?? '—'}`;
    case 'ORDER_CANCELLED':
      return 'заказ отменён';
    case 'ORDER_CREATED':
      return null;
    default:
      return null;
  }
}

function label(status: string | null): string {
  if (!status) return '—';
  return `«${orderStatusLabel(status as Parameters<typeof orderStatusLabel>[0])}»`;
}

function changedFieldsOf(records: AuditRecord[]): string[] {
  const fields = new Set<string>();
  for (const record of records) {
    if (record.action === 'STATUS_CHANGED' || record.action === 'ORDER_CANCELLED') {
      fields.add('status');
    }
    if (record.action.startsWith('COURIER_')) {
      fields.add('courierId');
    }
    if (record.action === 'ORDER_CANCELLED') {
      fields.add('cancelReason');
    }
  }
  return [...fields];
}
