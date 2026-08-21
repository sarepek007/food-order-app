import {
  ALLOWED_TRANSITIONS,
  CANCELLABLE_STATUSES,
  DEFAULT_COURIER_ACTIVE_LIMIT,
  occupiesCourierSlot,
  requiresCourier,
  type AuditAction,
  type OrderStatus,
} from '@food/contracts';
import { CANCEL_REASONS, COURIER_NAMES, CUSTOMER_NAMES, RESTAURANTS, STATUS_COMMENTS, STREETS } from './data.js';
import { SeededRandom } from './random.js';

export const DEFAULT_SEED = 20_260_521;

const OPERATORS = ['Анна Петрова', 'Борис Кириллов', 'Светлана Ким', 'Дмитрий Лавров'] as const;
const SYSTEM_ACTOR = 'система';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface SeedEvent {
  action: AuditAction;
  oldStatus: OrderStatus | null;
  newStatus: OrderStatus | null;
  oldCourierIndex: number | null;
  newCourierIndex: number | null;
  comment: string | null;
  actor: string;
  at: Date;
  orderVersion: number;
}

export interface PlannedOrder {
  id: string;
  restaurantIndex: number;
  courierIndex: number | null;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: string;
  totalAmount: string;
  status: OrderStatus;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Момент последней смены статуса — не то же самое, что updatedAt. */
  statusChangedAt: Date;
  version: number;
  events: SeedEvent[];
}

export interface SeedPlan {
  restaurants: { id: string; name: string; address: string }[];
  couriers: { id: string; name: string; phone: string; isActive: boolean }[];
  orders: PlannedOrder[];
}

export interface SeedPlanOptions {
  seed?: number;
  restaurants?: number;
  couriers?: number;
  orders?: number;
  courierActiveLimit?: number;
  now?: Date;
}

/**
 * Путь по конвейеру от `new` до целевого статуса.
 * Считается по графу переходов из @food/contracts, а не хардкодом: если
 * жизненный цикл изменится, seed либо перестроится, либо честно упадёт.
 */
export function progressPathTo(target: OrderStatus): OrderStatus[] {
  if (target === 'new') return [];

  const path: OrderStatus[] = [];
  let current: OrderStatus = 'new';

  while (current !== target) {
    const next: OrderStatus | undefined = ALLOWED_TRANSITIONS[current].find(
      (status) => status !== 'cancelled',
    );
    if (!next) {
      throw new Error(`Из статуса ${current} нельзя попасть в ${target}`);
    }
    path.push(next);
    current = next;
    if (path.length > 10) {
      throw new Error(`Не удалось построить путь до ${target}`);
    }
  }

  return path;
}

/** Возрастные корзины: свежие заказы чаще в ранних статусах, старые — доставлены. */
const AGE_BUCKETS = [
  { weight: 30, minDays: 0, maxDays: 2 },
  { weight: 30, minDays: 2, maxDays: 7 },
  { weight: 40, minDays: 7, maxDays: 30 },
] as const;

const STATUS_BY_AGE: readonly (readonly (readonly [OrderStatus, number])[])[] = [
  [
    ['new', 25],
    ['accepted', 20],
    ['preparing', 20],
    ['ready', 15],
    ['picked_up', 10],
    ['delivered', 5],
    ['cancelled', 5],
  ],
  [
    ['new', 3],
    ['accepted', 5],
    ['preparing', 7],
    ['ready', 10],
    ['picked_up', 10],
    ['delivered', 55],
    ['cancelled', 10],
  ],
  [
    ['new', 2],
    ['accepted', 2],
    ['preparing', 3],
    ['ready', 2],
    ['picked_up', 3],
    ['delivered', 73],
    ['cancelled', 15],
  ],
];

function buildAddress(random: SeededRandom): string {
  const street = random.pick(STREETS);
  const variant = random.pick(street.variants);
  const house = random.int(1, street.maxHouse);

  const houseText = random.weighted([
    [`д. ${house}`, 4],
    [`${house}`, 4],
    [`дом ${house}`, 1],
  ]);

  const parts = [`${variant}, ${houseText}`];

  if (random.bool(0.55)) {
    parts.push(random.weighted([[`кв. ${random.int(1, 250)}`, 5], [`оф. ${random.int(1, 60)}`, 1]]));
  }
  if (random.bool(0.2)) {
    parts.push(`подъезд ${random.int(1, 8)}`);
  }

  return parts.join(', ');
}

function buildPhone(random: SeededRandom): string {
  return `+7 (9${random.int(10, 99)}) ${random.int(100, 999)}-${random.int(10, 99)}-${random.int(10, 99)}`;
}

/**
 * Строит воспроизводимый набор данных.
 *
 * Ключевое свойство: заказ не «проставляется» в случайный статус, а проходит
 * по графу переходов, порождая согласованные журнал, версию и временные метки.
 * Инварианты домена соблюдаются по построению, а не проверяются постфактум.
 */
export function buildSeedPlan(options: SeedPlanOptions = {}): SeedPlan {
  const {
    seed = DEFAULT_SEED,
    restaurants: restaurantCount = 20,
    couriers: courierCount = 20,
    orders: orderCount = 200,
    courierActiveLimit = DEFAULT_COURIER_ACTIVE_LIMIT,
    now = new Date(),
  } = options;

  if (restaurantCount > RESTAURANTS.length || courierCount > COURIER_NAMES.length) {
    throw new Error('Недостаточно справочных данных для запрошенного объёма');
  }

  const random = new SeededRandom(seed);

  const restaurants = RESTAURANTS.slice(0, restaurantCount).map((restaurant) => ({
    id: random.uuid(),
    ...restaurant,
  }));
  const couriers = COURIER_NAMES.slice(0, courierCount).map((name, index) => ({
    id: random.uuid(),
    name,
    phone: buildPhone(random),
    // Пара неактивных курьеров нужна, чтобы было видно обработку COURIER_INACTIVE.
    isActive: index % 11 !== 10,
  }));

  const activeCourierIndexes = couriers
    .map((courier, index) => (courier.isActive ? index : -1))
    .filter((index) => index >= 0);

  /** Сколько активных доставок уже отдано каждому курьеру. */
  const courierLoad = new Map<number, number>();
  const loadOf = (index: number): number => courierLoad.get(index) ?? 0;

  const orders: PlannedOrder[] = [];

  for (let index = 0; index < orderCount; index += 1) {
    const bucketIndex = random.weighted(AGE_BUCKETS.map((bucket, i) => [i, bucket.weight] as const));
    const bucket = AGE_BUCKETS[bucketIndex]!;

    let target = random.weighted(STATUS_BY_AGE[bucketIndex]!);
    const cancelAfter: OrderStatus | null =
      target === 'cancelled' ? random.weighted(CANCELLABLE_STATUSES.map((s) => [s, s === 'ready' ? 1 : 3] as const)) : null;

    // Заказ занимает слот курьера только в ready и picked_up. Если свободных
    // курьеров нет, цель понижается до preparing — данные остаются валидными.
    const needsSlot = occupiesCourierSlot(target);
    let courierIndex: number | null = null;

    if (needsSlot) {
      const available = activeCourierIndexes.filter((i) => loadOf(i) < courierActiveLimit);
      if (available.length === 0) {
        target = 'preparing';
      } else {
        courierIndex = random.pick(available);
        courierLoad.set(courierIndex, loadOf(courierIndex) + 1);
      }
    }

    const effectiveTarget = cancelAfter ?? target;
    const path = progressPathTo(effectiveTarget);

    if (courierIndex === null) {
      const mustHaveCourier =
        requiresCourier(effectiveTarget) || path.some((status) => requiresCourier(status));
      // Часть заказов намеренно остаётся без курьера — для empty-состояний и фильтра.
      if (mustHaveCourier || random.bool(0.45)) {
        courierIndex = random.pick(activeCourierIndexes);
      }
    }

    // Курьер назначается до выхода заказа из preparing.
    const latestAssignStep = path.findIndex((status) => requiresCourier(status));
    const maxAssignIndex = latestAssignStep === -1 ? path.length : latestAssignStep;
    const assignAfterIndex = courierIndex === null ? -2 : random.int(-1, Math.max(-1, maxAssignIndex - 1));

    const events: SeedEvent[] = [];
    const totalSteps = path.length + (cancelAfter ? 1 : 0) + (courierIndex === null ? 0 : 1);
    const durationMs = totalSteps * random.int(6, 35) * MINUTE;

    const minOffset = Math.max(durationMs, bucket.minDays * DAY);
    const maxOffset = Math.max(minOffset + MINUTE, bucket.maxDays * DAY);
    const createdAt = new Date(now.getTime() - random.int(minOffset, maxOffset));

    let cursor = createdAt.getTime();
    let version = 1;
    const advance = (): Date => {
      cursor += random.int(4, 40) * MINUTE;
      return new Date(cursor);
    };

    events.push({
      action: 'ORDER_CREATED',
      oldStatus: null,
      newStatus: 'new',
      oldCourierIndex: null,
      newCourierIndex: assignAfterIndex === -1 ? courierIndex : null,
      comment: null,
      actor: SYSTEM_ACTOR,
      at: createdAt,
      orderVersion: version,
    });

    let current: OrderStatus = 'new';
    let assignedCourier: number | null = assignAfterIndex === -1 ? courierIndex : null;

    for (const [stepIndex, status] of path.entries()) {
      if (courierIndex !== null && assignedCourier === null && assignAfterIndex === stepIndex - 1) {
        version += 1;
        events.push({
          action: 'COURIER_ASSIGNED',
          oldStatus: current,
          newStatus: current,
          oldCourierIndex: null,
          newCourierIndex: courierIndex,
          comment: null,
          actor: random.pick(OPERATORS),
          at: advance(),
          orderVersion: version,
        });
        assignedCourier = courierIndex;
      }

      version += 1;
      events.push({
        action: 'STATUS_CHANGED',
        oldStatus: current,
        newStatus: status,
        oldCourierIndex: null,
        newCourierIndex: null,
        comment: random.bool(0.25) ? random.pick(STATUS_COMMENTS) : null,
        actor: random.pick(OPERATORS),
        at: advance(),
        orderVersion: version,
      });
      current = status;
    }

    // Курьер, назначенный уже после всех переходов (заказ без выхода в доставку).
    if (courierIndex !== null && assignedCourier === null) {
      version += 1;
      events.push({
        action: 'COURIER_ASSIGNED',
        oldStatus: current,
        newStatus: current,
        oldCourierIndex: null,
        newCourierIndex: courierIndex,
        comment: null,
        actor: random.pick(OPERATORS),
        at: advance(),
        orderVersion: version,
      });
      assignedCourier = courierIndex;
    }

    let cancelReason: string | null = null;
    if (cancelAfter) {
      cancelReason = random.pick(CANCEL_REASONS);
      version += 1;
      events.push({
        action: 'ORDER_CANCELLED',
        oldStatus: current,
        newStatus: 'cancelled',
        oldCourierIndex: null,
        newCourierIndex: null,
        comment: cancelReason,
        actor: random.pick(OPERATORS),
        at: advance(),
        orderVersion: version,
      });
      current = 'cancelled';
    }

    // Смена курьера двигает updated_at, но не статус, поэтому берём
    // время последнего события, которое действительно поменяло статус.
    const lastStatusEvent = [...events]
      .reverse()
      .find((event) => event.newStatus !== null && event.newStatus !== event.oldStatus);

    orders.push({
      id: random.uuid(),
      restaurantIndex: random.int(0, restaurants.length - 1),
      courierIndex: assignedCourier,
      customerName: random.pick(CUSTOMER_NAMES),
      customerPhone: random.bool(0.8) ? buildPhone(random) : null,
      deliveryAddress: buildAddress(random),
      totalAmount: random.money(300, 8000),
      status: current,
      cancelReason,
      createdAt,
      updatedAt: new Date(cursor),
      statusChangedAt: lastStatusEvent?.at ?? createdAt,
      version,
      events,
    });
  }

  // Сортировка по дате создания: человекочитаемые номера заказов должны
  // возрастать вместе со временем, иначе список выглядит неестественно.
  orders.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

  return { restaurants, couriers, orders };
}
