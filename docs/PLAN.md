# План работ

Каждый майлстоун закрывается зелёными тестами и коммитом. Спецификация — [SPEC.md](./SPEC.md).

| # | Майлстоун | Статус | Проверка |
|---|-----------|--------|----------|
| M0 | Окружение: pnpm, Docker | ✅ | `pnpm -v`, `docker info` |
| M1 | Каркас монорепы + `@food/contracts` | ✅ | `pnpm --filter @food/contracts test` (118 тестов) |
| M2 | БД: docker-compose, миграции, индексы, триггеры | ⬜ | `pnpm db:up && pnpm --filter @food/api migrate` |
| M3 | Репозитории и сервисы: транзакции, локи, версии | ⬜ | `pnpm --filter @food/api test` |
| M4 | HTTP-слой Fastify, OpenAPI, problem+json | ⬜ | `pnpm --filter @food/api test` |
| M5 | Seed 20 ресторанов / 20 курьеров / 200 заказов | ⬜ | `pnpm --filter @food/api seed` |
| M6 | Frontend React: список, карточка, состояния | ⬜ | `pnpm --filter @food/web test` |
| M7 | E2E, README, ADR | ⬜ | `pnpm lint && pnpm typecheck && pnpm test` |

## M1 — что сделано

`packages/contracts` — единственный источник правды о домене, импортируется и API, и веб-клиентом:

* `order-status.ts` — граф переходов данными (`ALLOWED_TRANSITIONS`), предикаты
  `isTerminal` / `isCancellable` / `occupiesCourierSlot` / `requiresCourier`;
* `order-rules.ts` — чистые проверки бизнес-правил, возвращающие `RuleResult`
  с кодом ошибки и готовым русским текстом (используется и сервером, и UI);
* `errors.ts` — коды ошибок, их HTTP-статусы, формат RFC 9457;
* `schemas.ts` — Zod-схемы запросов и ответов, из них же выводятся TS-типы и OpenAPI;
* `search.ts` — нормализация поискового запроса (общая для клиента и SQL);
* `audit.ts` — типы событий журнала.

Покрытие M1: 118 unit-тестов, БД не требуется.
