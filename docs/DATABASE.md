# Схема данных

Источник правды — [apps/api/migrations](../apps/api/migrations). Зеркало для
типизированных запросов — `apps/api/src/db/schema.ts` (сверяется тестом).

## Таблицы

| Таблица | Назначение |
|---------|------------|
| `restaurants` | справочник ресторанов |
| `couriers` | справочник курьеров |
| `orders` | заказы, включая счётчик версии |
| `order_audit_log` | журнал изменений, только добавление |
| `schema_migrations` | служебная таблица раннера миграций |

## Ключевые элементы схемы

### `orders.version`
Счётчик оптимистической блокировки. Ведётся триггером `trg_orders_bump_version`
(см. [ADR 0004](adr/0004-version-trigger.md)). Приложение его не выставляет.

### `orders.delivery_address_normalized`
`GENERATED ALWAYS AS (normalize_address(delivery_address)) STORED`.
SQL-функция `normalize_address` побайтово повторяет `normalizeSearchQuery()`
из `@food/contracts` — совпадение проверяется тестом. По колонке построен
GIN-индекс `gin_trgm_ops` для поиска с опечатками.

### Инварианты на уровне БД
| Ограничение | Смысл |
|-------------|-------|
| `orders_courier_required_from_ready` | в `ready`/`picked_up`/`delivered` курьер обязателен |
| `orders_cancel_reason_required` | отмена без причины запрещена |
| `orders_created_before_updated` | `updated_at >= created_at` |
| триггер `trg_audit_no_update` | `UPDATE`/`DELETE` журнала запрещены |

Дублирование доменных правил в БД сделано намеренно: у таблицы больше одного
писателя (API, seed, ручные операции), и последняя линия обороны должна быть в БД.

## Индексы

| Индекс | Для чего |
|--------|----------|
| `idx_orders_status`, `idx_orders_restaurant`, `idx_orders_courier` | фильтры списка |
| `idx_orders_created_at_id`, `idx_orders_updated_at_id` | сортировка и постраничный обход |
| `idx_orders_active_by_courier` (частичный) | подсчёт загрузки курьера под блокировкой |
| `idx_orders_address_trgm` (GIN) | нечёткий поиск по адресу |
| `idx_audit_order_created` | журнал заказа в обратном хронологическом порядке |

## Миграции

```bash
pnpm db:up                        # поднять Postgres
pnpm --filter @food/api migrate   # применить миграции
```

Раннер идемпотентен, применяет каждую миграцию в отдельной транзакции и
отказывается работать, если уже применённый файл был изменён.
