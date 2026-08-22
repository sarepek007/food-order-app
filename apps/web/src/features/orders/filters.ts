import { DEFAULT_PAGE_SIZE, ORDER_SORT_FIELDS, ORDER_STATUSES, type OrderStatus } from '@food/contracts';
import type { OrderListParams } from '@/api/orders';

export type SortField = (typeof ORDER_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

export interface OrderFilters {
  status: OrderStatus[];
  restaurantId: string[];
  courierId: string[];
  unassigned: boolean;
  /** Только заказы, превысившие норматив времени на текущий статус. */
  overdue: boolean;
  q: string;
  minAmount: string;
  maxAmount: string;
  createdFrom: string;
  createdTo: string;
  sort: SortField;
  order: SortDirection;
  page: number;
  pageSize: number;
}

export const DEFAULT_FILTERS: OrderFilters = {
  status: [],
  restaurantId: [],
  courierId: [],
  unassigned: false,
  overdue: false,
  q: '',
  minAmount: '',
  maxAmount: '',
  createdFrom: '',
  createdTo: '',
  sort: 'createdAt',
  order: 'desc',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

function parseList<T extends string>(raw: string | null, allowed?: readonly T[]): T[] {
  if (!raw) return [];
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean) as T[];

  return allowed ? values.filter((value) => allowed.includes(value)) : values;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Состояние, прочитанное из адреса, обязано быть корректным.
 *
 * Адрес приходит извне: его правят руками, копируют кусками, присылают
 * в переписке. Непроверенное значение уходило в запрос как есть, сервер
 * отвечал 400, и список оставался в ошибке до ручного сброса фильтров.
 */
function parseAmount(raw: string | null): string {
  if (!raw) return '';
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? raw : '';
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(raw: string | null): string {
  if (!raw || !DATE_ONLY.test(raw)) return '';

  // Формат верный, но дата может не существовать. JS не отвергает такие
  // значения, а переносит их: «2026-02-31» превращается в 3 марта.
  // Ловим это обратным преобразованием.
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10) === raw ? raw : '';
}

/**
 * Состояние фильтров живёт в адресной строке: ссылку на выборку можно
 * переслать коллеге, а F5 не сбрасывает работу оператора.
 */
export function filtersFromSearchParams(params: URLSearchParams): OrderFilters {
  const sort = params.get('sort');
  const order = params.get('order');

  return {
    status: parseList(params.get('status'), ORDER_STATUSES),
    restaurantId: parseList(params.get('restaurantId')),
    courierId: parseList(params.get('courierId')),
    unassigned: params.get('unassigned') === 'true',
    overdue: params.get('overdue') === 'true',
    q: params.get('q') ?? '',
    minAmount: parseAmount(params.get('minAmount')),
    maxAmount: parseAmount(params.get('maxAmount')),
    createdFrom: parseDate(params.get('createdFrom')),
    createdTo: parseDate(params.get('createdTo')),
    sort: (ORDER_SORT_FIELDS as readonly string[]).includes(sort ?? '')
      ? (sort as SortField)
      : DEFAULT_FILTERS.sort,
    order: order === 'asc' ? 'asc' : 'desc',
    page: parsePositiveInt(params.get('page'), 1),
    pageSize: parsePositiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE),
  };
}

/** В URL попадают только отличия от значений по умолчанию — адрес остаётся читаемым. */
export function filtersToSearchParams(filters: OrderFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.status.length > 0) params.set('status', filters.status.join(','));
  if (filters.restaurantId.length > 0) params.set('restaurantId', filters.restaurantId.join(','));
  if (filters.courierId.length > 0) params.set('courierId', filters.courierId.join(','));
  if (filters.unassigned) params.set('unassigned', 'true');
  if (filters.overdue) params.set('overdue', 'true');
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.minAmount) params.set('minAmount', filters.minAmount);
  if (filters.maxAmount) params.set('maxAmount', filters.maxAmount);
  if (filters.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters.createdTo) params.set('createdTo', filters.createdTo);
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.order !== DEFAULT_FILTERS.order) params.set('order', filters.order);
  if (filters.page !== 1) params.set('page', String(filters.page));
  if (filters.pageSize !== DEFAULT_FILTERS.pageSize) params.set('pageSize', String(filters.pageSize));

  return params;
}

/** Параметры запроса к API. Пустые значения не отправляются. */
export function filtersToQuery(filters: OrderFilters): OrderListParams {
  const query: OrderListParams = {
    sort: filters.sort,
    order: filters.order,
    page: filters.page,
    pageSize: filters.pageSize,
  };

  if (filters.status.length > 0) query.status = filters.status;
  if (filters.restaurantId.length > 0) query.restaurantId = filters.restaurantId;
  if (filters.courierId.length > 0) query.courierId = filters.courierId;
  if (filters.unassigned) query.unassigned = true;
  if (filters.overdue) query.overdue = true;
  if (filters.q.trim()) query.q = filters.q.trim();
  if (filters.minAmount) query.minAmount = Number(filters.minAmount);
  if (filters.maxAmount) query.maxAmount = Number(filters.maxAmount);
  // Даты уходят как есть: раскрытие в целые сутки делает сервер, и правило
  // остаётся одно на обе стороны. Раньше клиент расширял только верхнюю
  // границу, причём по местному времени, и окно съезжало на часовой пояс.
  if (filters.createdFrom) query.createdFrom = filters.createdFrom;
  if (filters.createdTo) query.createdTo = filters.createdTo;

  return query;
}

/** Есть ли хоть один фильтр, влияющий на выборку (сортировка и страница не в счёт). */
export function hasActiveFilters(filters: OrderFilters): boolean {
  return (
    filters.status.length > 0 ||
    filters.restaurantId.length > 0 ||
    filters.courierId.length > 0 ||
    filters.unassigned ||
    filters.overdue ||
    filters.q.trim() !== '' ||
    filters.minAmount !== '' ||
    filters.maxAmount !== '' ||
    filters.createdFrom !== '' ||
    filters.createdTo !== ''
  );
}

/** Сброс фильтров с сохранением сортировки: оператор обычно меняет только выборку. */
export function resetFilters(filters: OrderFilters): OrderFilters {
  return { ...DEFAULT_FILTERS, sort: filters.sort, order: filters.order, pageSize: filters.pageSize };
}

/** Любое изменение фильтра возвращает на первую страницу. */
export function withFilterChange(filters: OrderFilters, patch: Partial<OrderFilters>): OrderFilters {
  const next = { ...filters, ...patch };
  const keepsPage = 'page' in patch;
  return keepsPage ? next : { ...next, page: 1 };
}
