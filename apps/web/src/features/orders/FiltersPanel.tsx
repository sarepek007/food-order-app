import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@food/contracts';
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { useCouriersQuery, useRestaurantsQuery } from '@/api/queries';
import { hasActiveFilters, resetFilters, type OrderFilters } from './filters';

interface FiltersPanelProps {
  filters: OrderFilters;
  onChange: (patch: Partial<OrderFilters>) => void;
  onReset: () => void;
  total: number | undefined;
}

const SEARCH_DEBOUNCE_MS = 300;

export function FiltersPanel({ filters, onChange, onReset, total }: FiltersPanelProps) {
  const restaurants = useRestaurantsQuery();
  const couriers = useCouriersQuery();

  // Локальное состояние поля поиска: URL обновляется с задержкой,
  // иначе каждый символ порождает запрос и запись в историю.
  const [search, setSearch] = useState(filters.q);

  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => onChange({ q: search }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filters.q, onChange]);

  function toggleStatus(status: OrderStatus): void {
    const next = filters.status.includes(status)
      ? filters.status.filter((value) => value !== status)
      : [...filters.status, status];
    onChange({ status: next });
  }

  return (
    <section aria-label="Фильтры" className="rounded-lg bg-surface p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex min-w-64 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-muted">Поиск по адресу</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Например: Лениский проспкт 12"
            className="rounded-md px-3 py-1.5 text-sm ring-1 ring-line focus:ring-2 focus:ring-accent"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Ресторан</span>
          <select
            value={filters.restaurantId[0] ?? ''}
            onChange={(event) =>
              onChange({ restaurantId: event.target.value ? [event.target.value] : [] })
            }
            disabled={restaurants.isLoading}
            className="min-w-44 rounded-md bg-surface px-3 py-1.5 text-sm ring-1 ring-line"
          >
            <option value="">Все рестораны</option>
            {restaurants.data?.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Курьер</span>
          <select
            value={filters.unassigned ? 'unassigned' : (filters.courierId[0] ?? '')}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'unassigned') onChange({ unassigned: true, courierId: [] });
              else onChange({ unassigned: false, courierId: value ? [value] : [] });
            }}
            disabled={couriers.isLoading}
            className="min-w-44 rounded-md bg-surface px-3 py-1.5 text-sm ring-1 ring-line"
          >
            <option value="">Любой курьер</option>
            <option value="unassigned">Без курьера</option>
            {couriers.data?.map((courier) => (
              <option key={courier.id} value={courier.id}>
                {courier.name} ({courier.activeOrdersCount}/{courier.activeLimit})
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Сумма от</span>
            <input
              type="number"
              min="0"
              value={filters.minAmount}
              onChange={(event) => onChange({ minAmount: event.target.value })}
              className="w-24 rounded-md px-2 py-1.5 text-sm ring-1 ring-line"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">до</span>
            <input
              type="number"
              min="0"
              value={filters.maxAmount}
              onChange={(event) => onChange({ maxAmount: event.target.value })}
              className="w-24 rounded-md px-2 py-1.5 text-sm ring-1 ring-line"
            />
          </label>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Создан с</span>
            <input
              type="date"
              value={filters.createdFrom}
              onChange={(event) => onChange({ createdFrom: event.target.value })}
              className="rounded-md px-2 py-1.5 text-sm ring-1 ring-line"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">по</span>
            <input
              type="date"
              value={filters.createdTo}
              onChange={(event) => onChange({ createdTo: event.target.value })}
              className="rounded-md px-2 py-1.5 text-sm ring-1 ring-line"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">Статус:</span>
        {ORDER_STATUSES.map((status) => {
          const active = filters.status.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => toggleStatus(status)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
                active
                  ? 'bg-accent text-white ring-accent'
                  : 'bg-surface text-muted ring-line hover:bg-slate-50'
              }`}
            >
              {ORDER_STATUS_LABELS[status]}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-3">
          {total !== undefined && (
            <span className="text-xs text-muted" data-testid="orders-total">
              Найдено: {total}
            </span>
          )}
          {hasActiveFilters(filters) && (
            <Button variant="ghost" onClick={onReset}>
              Сбросить фильтры
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export { resetFilters };
