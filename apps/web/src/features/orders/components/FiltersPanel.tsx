import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@food/contracts';
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { ClockIcon, FilterIcon, SearchIcon } from '@/components/icons';
import { useCouriersQuery, useRestaurantsQuery } from '@/api/queries';
import { hasActiveFilters, resetFilters, type OrderFilters } from '../filters';

interface FiltersPanelProps {
  filters: OrderFilters;
  onChange: (patch: Partial<OrderFilters>) => void;
  onReset: () => void;
  total: number | undefined;
}

const SEARCH_DEBOUNCE_MS = 300;

const FIELD =
  'rounded-lg bg-surface px-3 text-sm text-ink ring-1 ring-line transition-shadow outline-none focus:ring-2 focus:ring-accent';
const LABEL = 'text-[11px] font-medium tracking-wide text-muted uppercase';

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
    <section
      aria-label="Фильтры"
      className="rounded-xl bg-surface p-4 shadow-card ring-1 ring-line"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,2fr)_repeat(2,minmax(9rem,1fr))_auto_auto]">
        {/* Подсказка вынесена из <label>: внутри она попала бы в доступное
            имя поля, и скринридер читал бы её как часть подписи. */}
        <div className="flex flex-col gap-1">
          <label htmlFor="orders-search" className={LABEL}>
            Поиск по адресу
          </label>
          <span className="relative flex items-center">
            <SearchIcon className="pointer-events-none absolute left-2.5 text-faint" />
            <input
              id="orders-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-describedby="orders-search-hint"
              placeholder="Например: Ленинский проспект, 12"
              className={`${FIELD} h-9 w-full pl-8`}
            />
          </span>
          {/* Терпимость к опечаткам названа словами, а не показана опечаткой
              в примере: такой пример читается как небрежность, а не как приём. */}
          <span id="orders-search-hint" className="text-[11px] text-muted">
            Находит и при ошибках в наборе: «Лениский проспкт» тоже сработает
          </span>
        </div>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Ресторан</span>
          <select
            value={filters.restaurantId[0] ?? ''}
            onChange={(event) =>
              onChange({ restaurantId: event.target.value ? [event.target.value] : [] })
            }
            disabled={restaurants.isLoading}
            className={`${FIELD} h-9`}
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
          <span className={LABEL}>Курьер</span>
          <select
            value={filters.unassigned ? 'unassigned' : (filters.courierId[0] ?? '')}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'unassigned') onChange({ unassigned: true, courierId: [] });
              else onChange({ unassigned: false, courierId: value ? [value] : [] });
            }}
            disabled={couriers.isLoading}
            className={`${FIELD} h-9`}
          >
            <option value="">Любой курьер</option>
            <option value="unassigned">Без курьера</option>
            {couriers.data?.map((courier) => (
              <option key={courier.id} value={courier.id}>
                {`${courier.name} (${courier.activeOrdersCount}/${courier.activeLimit})`}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Сумма, ₽</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="0"
              value={filters.minAmount}
              onChange={(event) => onChange({ minAmount: event.target.value })}
              aria-label="Сумма от"
              placeholder="от"
              className={`${FIELD} tabular h-9 w-20`}
            />
            <span aria-hidden="true" className="text-faint">
              —
            </span>
            <input
              type="number"
              min="0"
              value={filters.maxAmount}
              onChange={(event) => onChange({ maxAmount: event.target.value })}
              aria-label="Сумма до"
              placeholder="до"
              className={`${FIELD} tabular h-9 w-20`}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Дата создания</span>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={filters.createdFrom}
              onChange={(event) => onChange({ createdFrom: event.target.value })}
              aria-label="Создан с"
              className={`${FIELD} h-9`}
            />
            <span aria-hidden="true" className="text-faint">
              —
            </span>
            <input
              type="date"
              value={filters.createdTo}
              onChange={(event) => onChange({ createdTo: event.target.value })}
              aria-label="Создан по"
              className={`${FIELD} h-9`}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        <span className="mr-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
          <FilterIcon className="size-3.5" />
          Статус
        </span>

        {ORDER_STATUSES.map((status) => {
          const active = filters.status.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => toggleStatus(status)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'bg-accent text-white ring-1 ring-accent'
                  : 'bg-surface text-ink-soft ring-1 ring-line hover:bg-surface-muted hover:ring-line-strong'
              }`}
            >
              {ORDER_STATUS_LABELS[status]}
            </button>
          );
        })}

        {/* Отдельно от статусов: это фильтр по нарушению норматива,
            а не по значению поля. */}
        <button
          type="button"
          aria-pressed={filters.overdue}
          onClick={() => onChange({ overdue: !filters.overdue })}
          className={`ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            filters.overdue
              ? 'bg-danger text-white ring-1 ring-danger'
              : 'bg-surface text-danger ring-1 ring-red-200 hover:bg-danger-soft'
          }`}
        >
          <ClockIcon className="size-3.5" />
          Только просроченные
        </button>

        <div className="ml-auto flex items-center gap-3">
          {total !== undefined && (
            <span className="text-xs text-muted" data-testid="orders-total">
              {`Найдено: ${total}`}
            </span>
          )}
          {hasActiveFilters(filters) && (
            <Button variant="ghost" size="sm" onClick={onReset}>
              Сбросить фильтры
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export { resetFilters };
