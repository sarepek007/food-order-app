import type { OrderListItem } from '@food/contracts';
import { Link } from 'react-router';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDateTime, formatMoney, formatRelative } from '@/lib/format';
import type { OrderFilters, SortField } from './filters';

interface OrdersTableProps {
  items: OrderListItem[];
  filters: OrderFilters;
  onSort: (field: SortField) => void;
  children?: React.ReactNode;
}

const SORTABLE: Partial<Record<string, SortField>> = {
  status: 'status',
  totalAmount: 'totalAmount',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

interface Column {
  key: string;
  title: string;
  align?: 'right';
}

const COLUMNS: Column[] = [
  { key: 'publicNumber', title: '№' },
  { key: 'status', title: 'Статус' },
  { key: 'customerName', title: 'Клиент' },
  { key: 'restaurant', title: 'Ресторан' },
  { key: 'courier', title: 'Курьер' },
  { key: 'totalAmount', title: 'Сумма', align: 'right' },
  { key: 'deliveryAddress', title: 'Адрес' },
  { key: 'createdAt', title: 'Создан' },
  { key: 'updatedAt', title: 'Изменён' },
];

export function OrdersTable({ items, filters, onSort, children }: OrdersTableProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
          {COLUMNS.map((column) => {
            const sortField = SORTABLE[column.key];
            const isSorted = sortField !== undefined && filters.sort === sortField;

            return (
              <th
                key={column.key}
                scope="col"
                aria-sort={isSorted ? (filters.order === 'asc' ? 'ascending' : 'descending') : undefined}
                className={`px-3 py-2 font-medium ${column.align === 'right' ? 'text-right' : ''}`}
              >
                {sortField ? (
                  <button
                    type="button"
                    onClick={() => onSort(sortField)}
                    className="inline-flex items-center gap-1 hover:text-ink"
                  >
                    {column.title}
                    <span aria-hidden="true" className={isSorted ? 'text-accent' : 'text-slate-300'}>
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
            <tr key={order.id} className="border-t border-line hover:bg-slate-50">
              <td className="px-3 py-2 font-medium">
                <Link
                  to={`/orders/${order.id}`}
                  className="text-accent hover:underline"
                  aria-label={`Открыть заказ №${order.publicNumber}`}
                >
                  {order.publicNumber}
                </Link>
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={order.status} />
              </td>
              <td className="px-3 py-2">{order.customerName}</td>
              <td className="px-3 py-2 text-muted">{order.restaurant.name}</td>
              <td className="px-3 py-2">
                {order.courier ? (
                  order.courier.name
                ) : (
                  <span className="text-slate-400">— не назначен</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatMoney(order.totalAmount, order.currency)}
              </td>
              <td className="max-w-64 truncate px-3 py-2 text-muted" title={order.deliveryAddress}>
                {order.deliveryAddress}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted" title={formatDateTime(order.createdAt)}>
                {formatRelative(order.createdAt)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted" title={formatDateTime(order.updatedAt)}>
                {formatRelative(order.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      )}
    </table>
  );
}

export const ORDERS_TABLE_COLUMNS = COLUMNS.length;
