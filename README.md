# Food Order App — консоль операционной команды

Fullstack-приложение для просмотра и управления заказами ресторанов:
список с фильтрами и нечётким поиском по адресу, карточка заказа с журналом изменений,
переходы по жизненному циклу, назначение курьеров с лимитом активных доставок
и корректная обработка конкурентного редактирования.

Спецификация: [docs/SPEC.md](docs/SPEC.md) · План: [docs/PLAN.md](docs/PLAN.md) · Решения: [docs/adr](docs/adr)

## Стек

| Слой | Технология |
|------|------------|
| БД | PostgreSQL 16 + `pg_trgm` |
| Backend | Node.js 22+, TypeScript, Fastify, Zod |
| Frontend | React, TypeScript, Vite, TanStack Query |
| Общий домен | `packages/contracts` — статусы, правила, схемы |
| Тесты | Vitest, Playwright |

## Структура

```
packages/contracts  общий домен: граф статусов, бизнес-правила, Zod-схемы
apps/api            REST API (Fastify)
apps/web            React SPA
docs                спецификация, план, ADR
```

## Требования

* Node.js >= 22 (проверено на 26)
* pnpm 11 (`npm i -g pnpm`)
* Docker (для Postgres)

## Быстрый старт

```bash
pnpm install
pnpm db:up                        # Postgres в Docker
pnpm --filter @food/api migrate   # применить миграции
pnpm test                         # тесты всех пакетов
```

Схема БД и её инварианты: [docs/DATABASE.md](docs/DATABASE.md).

## Команды

| Команда | Что делает |
|---------|------------|
| `pnpm test` | тесты во всех пакетах |
| `pnpm typecheck` | строгая проверка типов |
| `pnpm lint` | ESLint по всему воркспейсу |
| `pnpm format` | Prettier |
| `pnpm db:up` / `pnpm db:down` | поднять/остановить Postgres |
| `pnpm --filter @food/api migrate` | применить миграции |

## Состояние работ

* **M1** — доменный пакет `@food/contracts`: граф переходов, бизнес-правила,
  коды ошибок, Zod-схемы. 118 unit-тестов без БД.
* **M2** — схема Postgres, раннер миграций, Drizzle-слой, конфигурация.
* **M3** — репозитории и сервисный слой: жизненный цикл заказа, назначение
  курьеров с лимитом активных доставок, отмена, журнал изменений, список
  с фильтрами и нечётким поиском. Оптимистическая блокировка по версии
  и advisory-лок по курьеру — 110 интеграционных тестов, из них 11 на конкурентность.

Итого 228 тестов. Прогресс по майлстоунам — в [docs/PLAN.md](docs/PLAN.md).
