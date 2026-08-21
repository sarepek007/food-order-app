import type { OrderListItem } from '@food/contracts';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { SlaIndicator } from '@/components/SlaIndicator';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDateTime, formatMoney, formatRelative } from '@/lib/format';
import type { OrderFilters, SortField } from './filters';

interface OrdersTableProps {
  items: OrderListItem[];
  filters: OrderFilters;
  onSort: (field: SortField) => void;
  children?: ReactNode;
}

interface Column {
  key: string;
  title: string;
  sort?: SortField;
  align?: 'right';
  /**
   * Приоритет колонки: на узком экране второстепенные скрываются,
   * чтобы таблица не превращалась в горизонтальную ленту.
   */
  visibility?: string;
}

const COLUMNS: Column[] = [
  { key: 'publicNumber', title: '№' },
  { key: 'status', title: 'Статус', sort: 'status' },
  { key: 'timeInStatus', title: 'В статусе', sort: 'timeInStatus' },
  { key: 'customerName', title: 'Клиент' },
  { key: 'restaurant', title: 'Ресторан', visibility: 'hidden lg:table-cell' },
  { key: 'courier', title: 'Курьер', visibility: 'hidden md:table-cell' },
  { key: 'totalAmount', title: 'Сумма', sort: 'totalAmount', align: 'right' },
  { key: 'deliveryAddress', title: 'Адрес', visibility: 'hidden lg:table-cell' },
  { key: 'createdAt', title: 'Создан', sort: 'createdAt', visibility: 'hidden md:table-cell' },
  { key: 'updatedAt', title: 'Изменён', sort: 'updatedAt', visibility: 'hidden xl:table-cell' },
];

export const ORDERS_TABLE_COLUMNS = COLUMNS.length;

export function OrdersTable({ items, filters, onSort, children }: OrdersTableProps) {
  return (
    <table className="sticky-head w-full border-collapse text-sm">
      <thead>
        <tr className="text-left">
          {COLUMNS.map((column) => {
            const isSorted = column.sort !== undefined && filters.sort === column.sort;

            return (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  isSorted ? (filters.order === 'asc' ? 'ascending' : 'descending') : undefined
                }
                className={`px-2 py-2.5 text-[11px] sm:px-3 font-semibold tracking-wide text-muted uppercase ${
                  column.align === 'right' ? 'text-right' : ''
                } ${column.visibility ?? ''}`}
              >
                {column.sort ? (
                  <button
                    type="button"
                    onClick={() => onSort(column.sort!)}
                    className={`inline-flex items-center gap-1 rounded transition-colors hover:text-ink ${
                      isSorted ? 'text-accent' : ''
                    }`}
                  >
                    {column.title}
                    <span aria-hidden="true" className={isSorted ? '' : 'text-slate-300'}>
                      {isSorted && filters.order === 'asc' ? '↑' : '↓'}
                    </span>
                  </button>
                ) : (
                  column.title
                )}
              </th>
            );
          })}
        </tr>
      </thead>

      {children ?? (
        <tbody>
          {items.map((order) => (
            <tr
              key={order.id}
              /* Просроченный заказ — исключение, ради которого оператор
                 и открывает список: подсвечиваем всю строку. */
              className={`border-t border-line transition-colors ${
                order.slaState === 'overdue'
                  ? 'bg-danger-soft/60 hover:bg-danger-soft'
                  : 'hover:bg-accent-soft/50'
              }`}
            >
              <td className="px-2 py-3 sm:px-3">
                <Link
                  to={`/orders/${order.id}`}
                  className="tabular font-semibold text-accent hover:underline"
                  aria-label={`Открыть заказ №${order.publicNumber}`}
                >
                  {order.publicNumber}
                </Link>
              </td>

              <td className="px-2 py-3 sm:px-3">
                <StatusBadge status={order.status} />
              </td>

              <td className="px-2 py-3 sm:px-3">
                <SlaIndicator
                  state={order.slaState}
                  secondsInStatus={order.secondsInStatus}
                  limitSeconds={order.slaLimitSeconds}
                />
              </td>

              {/* Ограничение ширины обязательно: без него truncate в ячейке
                  таблицы не работает — колонка растягивается под содержимое. */}
              <td className="max-w-[6rem] px-2 py-3 sm:max-w-[12rem] sm:px-3 lg:max-w-none">
                <span className="block truncate font-medium text-ink">{order.customerName}</span>

                {/* Ресторан и адрес скрыты отдельными колонками на узких
                    экранах — их содержимое сворачивается сюда одной строкой.
                    Строка склеенная, поэтому не конкурирует с колонками
                    при точном поиске по тексту. */}
                <span className="mt-0.5 block truncate text-xs text-muted lg:hidden">
                  {`${order.restaurant.name} · ${order.deliveryAddress}`}
                </span>
              </td>

              <td className="hidden px-3 py-3 text-ink-soft lg:table-cell">{order.restaurant.name}</td>

              <td className="hidden px-3 py-3 md:table-cell">
                {order.courier ? (
                  <span className="text-ink-soft">{order.courier.name}</span>
                ) : (
                  <span className="text-faint">— не назначен</span>
                )}
              </td>

              <td className="tabular px-2 py-3 text-right font-medium whitespace-nowrap sm:px-3">
                {formatMoney(order.totalAmount, order.currency)}
              </td>

              <td
                className="hidden max-w-64 truncate px-3 py-3 text-muted lg:table-cell"
                title={order.deliveryAddress}
              >
                {order.deliveryAddress}
              </td>

              <td
                className="hidden px-3 py-3 whitespace-nowrap text-muted md:table-cell"
                title={formatDateTime(order.createdAt)}
              >
                {formatRelative(order.createdAt)}
              </td>

              <td
                className="hidden px-3 py-3 whitespace-nowrap text-muted xl:table-cell"
                title={formatDateTime(order.updatedAt)}
              >
                {formatRelative(order.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      )}
    </table>
  );
}
