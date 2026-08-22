import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useOrdersQuery } from '@/api/queries';
import { useOrderStream } from '@/api/stream';
import { useThrottled } from '@/lib/useThrottled';
import { errorMessage, isNetworkError } from '@/api/errors';
import { Button } from '@/components/Button';
import { EmptyState, ErrorState, RefetchingBar, TableSkeleton } from '@/components/states';
import { FiltersPanel } from '../components/FiltersPanel';
import { Pagination } from '../components/Pagination';
import { ORDERS_TABLE_COLUMNS, OrdersTable } from '../components/OrdersTable';
import {
  filtersFromSearchParams,
  filtersToQuery,
  filtersToSearchParams,
  hasActiveFilters,
  resetFilters,
  withFilterChange,
  type OrderFilters,
  type SortField,
} from '../filters';

/** Не чаще одного обновления списка в секунду. */
const LIVE_REFRESH_INTERVAL_MS = 1000;

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const query = useMemo(() => filtersToQuery(filters), [filters]);
  const orders = useOrdersQuery(query);

  // Живое обновление списка. Пачка событий подряд (оператор ведёт заказ
  // по конвейеру) не должна превращаться в шторм запросов.
  const queryClient = useQueryClient();
  const refreshList = useThrottled(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    }, [queryClient]),
    LIVE_REFRESH_INTERVAL_MS,
  );

  useOrderStream({ onChange: refreshList, onReconnect: refreshList });

  const applyFilters = useCallback(
    (next: OrderFilters) => {
      // Фильтры — часть адреса: ссылку можно переслать, F5 ничего не теряет.
      setSearchParams(filtersToSearchParams(next), { replace: true });
    },
    [setSearchParams],
  );

  const change = useCallback(
    (patch: Partial<OrderFilters>) => applyFilters(withFilterChange(filters, patch)),
    [applyFilters, filters],
  );

  const sortBy = useCallback(
    (field: SortField) => {
      const sameField = filters.sort === field;
      change({ sort: field, order: sameField && filters.order === 'desc' ? 'asc' : 'desc' });
    },
    [change, filters.order, filters.sort],
  );

  const isInitialLoading = orders.isLoading;
  const items = orders.data?.items ?? [];
  const filtered = hasActiveFilters(filters);

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Заказы</h1>
        <p className="text-sm text-muted">Просмотр и управление заказами ресторанов</p>
      </header>

      <FiltersPanel
        filters={filters}
        onChange={change}
        onReset={() => applyFilters(resetFilters(filters))}
        total={orders.data?.total}
      />

      <section className="relative overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-line">
        <RefetchingBar active={orders.isFetching && !isInitialLoading} />

        <div className="max-h-[calc(100vh-19rem)] overflow-auto">
          <OrdersTable items={items} filters={filters} onSort={sortBy}>
            {isInitialLoading ? <TableSkeleton columns={ORDERS_TABLE_COLUMNS} /> : undefined}
          </OrdersTable>
        </div>

        {orders.isError && (
          <ErrorState
            title={isNetworkError(orders.error) ? 'Нет связи с сервером' : 'Не удалось загрузить заказы'}
            description={errorMessage(orders.error)}
            onRetry={() => void orders.refetch()}
            retrying={orders.isFetching}
          />
        )}

        {!orders.isError && !isInitialLoading && items.length === 0 && (
          <EmptyState
            title={filtered ? 'Ничего не найдено' : 'Заказов пока нет'}
            description={
              filtered
                ? 'Попробуйте изменить условия поиска: возможно, фильтры слишком узкие.'
                : 'Как только появится первый заказ, он окажется в этом списке.'
            }
            tone={filtered ? 'search' : 'neutral'}
            action={
              filtered ? (
                <Button variant="secondary" onClick={() => applyFilters(resetFilters(filters))}>
                  Сбросить фильтры
                </Button>
              ) : undefined
            }
          />
        )}

        {orders.data && orders.data.total > 0 && (
          <Pagination
            page={orders.data.page}
            pageSize={orders.data.pageSize}
            total={orders.data.total}
            totalPages={orders.data.totalPages}
            onPageChange={(page) => change({ page })}
            onPageSizeChange={(pageSize) => change({ pageSize })}
          />
        )}
      </section>
    </div>
  );
}
