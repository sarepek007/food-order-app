# Промт: Restaurant Orders Ops Console (fullstack)

> Ниже — готовый промт для передачи разработчику/LLM. Копируется целиком.

---

## 0. Роль и цель

Ты — senior fullstack-инженер. Спроектируй и реализуй production-grade приложение
**Orders Ops Console** — внутренний инструмент операционной команды доставки еды
для просмотра и управления заказами ресторанов.

Приоритеты (в порядке убывания): **корректность бизнес-правил и конкурентного доступа**
→ чистота доменной модели → качество API → UX состояний (loading/empty/error/conflict)
→ покрытие тестами → красота UI.

Аутентификация **не требуется**. Пользователь идентифицируется заголовком
`X-Actor: <string>` (по умолчанию `operator`) — он пишется в audit log как автор действия.

---

## 1. Технологический стек (обязательный)

| Слой | Технология |
|---|---|
| БД | PostgreSQL 16 (расширение `pg_trgm`) |
| Runtime | Node.js 22 LTS, TypeScript 5.x, `strict: true` |
| HTTP | Fastify 5 (`@fastify/cors`, `@fastify/swagger` + `scalar`/`swagger-ui`) |
| Доступ к БД | Drizzle ORM (или Prisma) + честные SQL-миграции в репозитории |
| Валидация | Zod (единые схемы, переиспользуемые фронтом через общий пакет `@app/contracts`) |
| Frontend | React 19 + TypeScript + Vite |
| Data layer | TanStack Query v5 + TanStack Router (или React Router v7) |
| Формы | React Hook Form + zodResolver |
| UI | shadcn/ui + Tailwind (допустима MUI/Mantine — но одна библиотека, без зоопарка) |
| Тесты | Vitest + Supertest/`fastify.inject`, Testcontainers для Postgres, Playwright для 2–3 e2e |
| Инфра | Docker Compose (postgres + api + web), `.env.example`, `pnpm` workspaces |

Структура монорепозитория:

```
/apps/api        — Fastify backend
/apps/web        — React frontend
/packages/contracts — Zod-схемы, типы DTO, enum статусов, правила переходов (общие для api и web)
/docker-compose.yml
/README.md
```

**Ключевое требование:** enum статусов, граф переходов и DTO объявлены **один раз**
в `packages/contracts` и импортируются и бекендом, и фронтом. Никакого дублирования строк-статусов.

---

## 2. Доменная модель

### 2.1 Таблицы

```sql
CREATE TYPE order_status AS ENUM
  ('new','accepted','preparing','ready','picked_up','delivered','cancelled');

CREATE TABLE restaurants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  address     text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE couriers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  phone       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_number    bigint GENERATED ALWAYS AS IDENTITY,      -- человекочитаемый номер для оператора
  status           order_status NOT NULL DEFAULT 'new',
  customer_name    text NOT NULL,
  customer_phone   text,
  restaurant_id    uuid NOT NULL REFERENCES restaurants(id),
  courier_id       uuid     NULL REFERENCES couriers(id),
  delivery_address text NOT NULL,
  total_amount     numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  currency         char(3) NOT NULL DEFAULT 'RUB',
  cancel_reason    text NULL,
  version          integer NOT NULL DEFAULT 1,               -- оптимистическая блокировка
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_audit_log (
  id            bigserial PRIMARY KEY,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action        text NOT NULL,          -- ORDER_CREATED | STATUS_CHANGED | COURIER_ASSIGNED
                                        -- | COURIER_CHANGED | COURIER_UNASSIGNED | ORDER_CANCELLED
  old_status    order_status NULL,
  new_status    order_status NULL,
  old_courier_id uuid NULL REFERENCES couriers(id),
  new_courier_id uuid NULL REFERENCES couriers(id),
  comment       text NULL,
  actor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

Индексы (обосновать каждый в README):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_orders_status          ON orders(status);
CREATE INDEX idx_orders_restaurant      ON orders(restaurant_id);
CREATE INDEX idx_orders_created_at_id   ON orders(created_at DESC, id DESC);  -- сортировка/пагинация
CREATE INDEX idx_orders_address_trgm    ON orders USING gin (delivery_address gin_trgm_ops);
CREATE INDEX idx_orders_active_courier  ON orders(courier_id) WHERE status IN ('ready','picked_up');
CREATE INDEX idx_audit_order_created    ON order_audit_log(order_id, created_at DESC, id DESC);
```

`updated_at` обновляется **триггером** `BEFORE UPDATE`, а не прикладным кодом.
`version` инкрементируется в том же триггере.

### 2.2 Audit log — только append

Записи аудита **никогда** не изменяются и не удаляются. Пишутся **в той же транзакции**,
что и изменение заказа (иначе возможен заказ без истории). Ревокировать через `REVOKE UPDATE, DELETE`
не обязательно, но не должно быть ни одного места в коде, где аудит апдейтится.

---

## 3. Бизнес-правила (сердце задачи)

### 3.1 Машина состояний

Разрешённые переходы объявляются **как данные**, а не как цепочка `if`:

```ts
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new:       ['accepted', 'cancelled'],
  accepted:  ['preparing', 'cancelled'],
  preparing: ['ready',     'cancelled'],
  ready:     ['picked_up', 'cancelled'],
  picked_up: ['delivered'],            // отмена уже невозможна
  delivered: [],                       // терминальный
  cancelled: [],                       // терминальный
};
export const CANCELLABLE = ['new','accepted','preparing','ready'] as const;
export const ACTIVE_FOR_COURIER = ['ready','picked_up'] as const;
```

Правила:
1. Переход разрешён только если `next ∈ ALLOWED_TRANSITIONS[current]`. Иначе `409 ORDER_INVALID_TRANSITION`
   с указанием текущего статуса и списка допустимых.
2. Отмена возможна только из `CANCELLABLE`; после `picked_up` — запрещена (`409 ORDER_NOT_CANCELLABLE`).
3. Переход в `ready` **требует назначенного курьера** (иначе заказ не сможет стать активным ни для кого) —
   `422 ORDER_COURIER_REQUIRED`. Это правило явно задокументировать в README как принятое допущение.
4. Терминальные статусы неизменяемы: любая попытка изменить `delivered`/`cancelled` заказ
   (в т.ч. смена курьера) → `409 ORDER_TERMINAL`.

### 3.2 Лимит курьера

Курьер не может иметь более **3** заказов в статусах `ready` или `picked_up`.
Лимит проверяется при **обоих** сценариях:
* назначение/смена курьера;
* перевод заказа в `ready` (заказ становится активным → счётчик курьера растёт).

**Гонка обязана быть исключена.** Реализация:

```
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('courier:' || :courierId, 0));
SELECT count(*) FROM orders
  WHERE courier_id = :courierId AND status IN ('ready','picked_up');
-- если >= 3 → откат с доменной ошибкой
UPDATE orders SET ... WHERE id = :orderId AND version = :expectedVersion;
INSERT INTO order_audit_log ...;
COMMIT;
```

Альтернатива (тоже принимается): `SELECT ... FOR UPDATE` по строке курьера + пересчёт.
Наивная проверка «посчитали, потом записали» без блокировки — **не принимается**.
Требуется тест, который параллельно шлёт 5 назначений на одного курьера и проверяет,
что успешных ровно столько, сколько допускает лимит.

Ошибка: `409 COURIER_CAPACITY_EXCEEDED`, в `details` — `courierId`, `activeCount`, `limit`, `activeOrderIds`.
Лимит выносится в конфиг (`COURIER_ACTIVE_LIMIT=3`).

### 3.3 Конкурентное изменение (оптимистическая блокировка)

Модель: `version` в БД + HTTP ETag.

* `GET /orders/:id` возвращает заголовок `ETag: "7"` и поле `version` в теле.
* Любая мутация обязана прислать `If-Match: "7"` (или, как fallback, `version` в теле — поддержать оба,
  заголовок в приоритете). Отсутствие → `428 Precondition Required`.
* `UPDATE orders SET ... WHERE id = $1 AND version = $2`; если `rowCount = 0` → **`409 Conflict`**
  с кодом `ORDER_VERSION_CONFLICT`.
* Тело конфликта содержит **актуальное состояние заказа** и краткое описание того, что изменилось,
  чтобы фронт мог показать пользователю разницу без второго запроса:

```json
{
  "type": "https://errors.app/order-version-conflict",
  "title": "Заказ был изменён другим пользователем",
  "status": 409,
  "code": "ORDER_VERSION_CONFLICT",
  "detail": "Пока вы работали с заказом, его изменил другой оператор (courier: Иван → Мария).",
  "details": {
    "expectedVersion": 7,
    "actualVersion": 9,
    "current": { "...полный OrderDetails..." },
    "changedFields": ["courierId", "updatedAt"]
  }
}
```

Тест-сценарий из ТЗ обязателен: A и B читают v7 → B назначает Alex (v8) → A назначает Maria с `If-Match: "7"`
→ **409**, курьер остаётся Alex.

### 3.4 Идемпотентность (плюс)

Мутации принимают необязательный `Idempotency-Key`; повторный запрос с тем же ключом и телом
возвращает исходный результат, не создавая второй записи в audit log.

---

## 4. REST API

Базовый путь `/api/v1`. Формат ошибок — **RFC 9457 `application/problem+json`** с дополнительным
машиночитаемым `code` и `details`. Единый error-handler Fastify; доменные исключения
(`DomainError` с полем `code` и `httpStatus`) маппятся в него централизованно, никаких `res.status(...)` по коду.

### 4.1 Эндпоинты

| Метод | Путь | Назначение | Коды |
|---|---|---|---|
| `GET` | `/orders` | список с фильтрами/поиском/сортировкой/пагинацией | 200, 400 |
| `GET` | `/orders/:id` | карточка заказа (+ETag) | 200, 404 |
| `GET` | `/orders/:id/audit` | audit log, пагинация, `?order=desc` | 200, 404 |
| `POST` | `/orders` | создание (нужно для seed/демо и тестов) | 201, 400, 422 |
| `PATCH` | `/orders/:id/status` | смена статуса `{ status, comment? }` | 200, 400, 404, 409, 422, 428 |
| `PUT` | `/orders/:id/courier` | назначить/сменить курьера `{ courierId }` | 200, 404, 409, 422, 428 |
| `DELETE` | `/orders/:id/courier` | снять курьера | 200, 404, 409, 428 |
| `POST` | `/orders/:id/cancel` | отмена `{ reason }` | 200, 404, 409, 422, 428 |
| `GET` | `/restaurants` | справочник для фильтров | 200 |
| `GET` | `/couriers` | справочник + `activeOrdersCount` и `hasCapacity` | 200 |
| `GET` | `/health` | liveness/readiness | 200, 503 |

Замечания по семантике HTTP:
* смена статуса — отдельный ресурс-подчинённый, а не «PATCH всего заказа со статусом внутри»:
  так бизнес-переход не смешивается с редактированием полей;
* `POST /cancel` — намеренно command-style, т.к. отмена требует `reason` и не является «установкой поля»;
* `404` — только для несуществующих сущностей; нарушение бизнес-правил — `409` (конфликт состояния)
  или `422` (запрос синтаксически валиден, но семантически неисполним);
* `400` — только ошибки схемы/парсинга (Zod);
* никаких `200 { "success": false }`.

### 4.2 `GET /orders` — параметры

```
status=new,accepted           # мультивыбор, CSV
restaurantId=<uuid>&restaurantId=<uuid>
courierId=<uuid> | unassigned=true
q=<строка>                    # нечёткий поиск по адресу
minAmount, maxAmount
createdFrom, createdTo        # ISO-8601
sort=createdAt|updatedAt|totalAmount|status|relevance
order=asc|desc                # default createdAt desc
page=1&pageSize=25            # pageSize ∈ [1,100], default 25
```

Ответ:

```json
{
  "items": [ { "id": "...", "publicNumber": 1042, "status": "preparing",
               "customerName": "...", "restaurant": {"id":"...","name":"..."},
               "courier": {"id":"...","name":"..."} | null,
               "deliveryAddress": "...", "totalAmount": "1290.00", "currency": "RUB",
               "createdAt": "...", "updatedAt": "...", "version": 3 } ],
  "page": 1, "pageSize": 25, "total": 200, "totalPages": 8
}
```

Валидация query — Zod с coercion; неизвестные/некорректные параметры → `400` со списком проблем по полям.
Сортировка — только по whitelist-полям (защита от SQL-инъекции через `ORDER BY`).

### 4.3 Нечёткий поиск по адресу

Реализовать через `pg_trgm`, а не `LIKE '%...%'`:

```sql
WHERE (:q IS NULL OR delivery_address % :q OR delivery_address ILIKE '%' || :q || '%')
ORDER BY similarity(delivery_address, :q) DESC, created_at DESC
```

* `SET pg_trgm.similarity_threshold = 0.25` (вынести в конфиг);
* нормализация запроса: trim, схлопывание пробелов, lower, `ё → е`;
* при `sort=relevance` — сортировка по `similarity`, иначе поиск работает как фильтр;
* тест: запрос `"Лениский проспкт 12"` находит `"Ленинский проспект, д. 12"`.

Для больших объёмов данных предусмотреть альтернативу keyset-пагинации (`cursor` по `(created_at, id)`)
и описать в README, почему для 200 записей взят offset.

---

## 5. Архитектура бекенда

Слоистая, с зависимостями внутрь:

```
routes/        — Fastify-роуты: только парсинг, вызов сервиса, сериализация; без бизнес-логики
services/      — сценарии: транзакции, блокировки, вызов домена, запись аудита
domain/        — чистые функции и типы: машина состояний, правила отмены, лимит курьера. БЕЗ импорта БД
repositories/  — SQL/ORM-запросы, единственное место, где известно про Postgres
errors/        — DomainError-иерархия + маппинг в problem+json
plugins/       — db, config (Zod-валидация env), logger (pino, requestId), swagger, errorHandler
```

Правила:
* Домен покрыт **юнит-тестами без БД** — переходы, отмена, расчёт capacity;
* каждая мутация выполняется в **одной транзакции**: проверка → UPDATE с version → INSERT в audit;
* репозиторий получает транзакционный контекст явным параметром (никаких скрытых ALS/глобалов);
* логирование структурное: `orderId`, `actor`, `action`, `fromStatus`, `toStatus`, `durationMs`;
* graceful shutdown, `connectionTimeout`, пул соединений из конфига;
* OpenAPI-схема генерируется из Zod (`fastify-type-provider-zod`), доступна на `/docs`.

---

## 6. Seed

Скрипт `pnpm --filter api seed` (идемпотентный: `--reset` очищает таблицы), детерминированный
(фиксированный seed генератора, чтобы демо воспроизводилось):

* 20 ресторанов (реалистичные названия и адреса);
* 20 курьеров;
* 200 заказов с **осмысленным распределением**:
  * все 7 статусов, включая ~10% `cancelled` (с `cancel_reason`) и заметную долю `delivered`;
  * `created_at` разбросан за последние 30 дней; свежие заказы — в ранних статусах;
  * адреса из ~10 улиц с вариациями написания (сокращения «ул./улица», «д. 5» / «дом 5») — чтобы было видно
    работу нечёткого поиска;
  * суммы 300–8000;
  * ~15% заказов без курьера (проверка empty-состояний и фильтра `unassigned`);
* **инварианты соблюдены**: ни один курьер не превышает лимит активных заказов;
  у заказов в `ready`/`picked_up`/`delivered` курьер назначен;
* для каждого заказа сгенерирована **правдоподобная история аудита**: цепочка переходов
  с возрастающими `created_at`, назначения/смены курьера. Аудит не выдумывается «задним числом»
  случайно — он строится тем же кодом, что и реальные переходы (прогон заказа по стейт-машине).

Seed **обязан** проходить те же доменные проверки, что и API — это тест самой модели.

---

## 7. Frontend

### 7.1 Экраны

**`/orders` — список**
* таблица с колонками: №, статус (цветной badge), клиент, ресторан, курьер (или «—»),
  сумма, адрес, создан, обновлён;
* панель фильтров: мультиселект статусов, мультиселект ресторанов, курьер / «без курьера»,
  диапазон дат, диапазон суммы, поиск по адресу с debounce 300 мс;
* сортировка кликом по заголовкам (createdAt, updatedAt, totalAmount);
* пагинация с выбором размера страницы;
* **всё состояние фильтров живёт в URL** (query string) — страница шарится ссылкой и переживает F5;
* «Сбросить фильтры»; счётчик «Найдено N заказов»;
* относительное время («12 минут назад») с точным значением в `title`.

**`/orders/:id` — карточка**
* все поля заказа + `version` (можно неявно, в отладочном виде);
* действия: **сменить статус** (кнопки только для разрешённых переходов — граф импортируется
  из `@app/contracts`, недопустимые действия не показываются, а не показываются задизабленными без объяснения),
  **назначить/сменить курьера** (в списке курьеров показывается загрузка `2/3`, переполненные —
  задизаблены с подсказкой), **отменить заказ** (модалка с обязательным `reason`, кнопка скрыта,
  если статус не отменяем);
* **Audit log** — таймлайн: действие, `old → new`, автор, время; иконка/цвет по типу действия.

### 7.2 Состояния UI (обязательны все)

| Состояние | Требование |
|---|---|
| loading | скелетоны таблицы и карточки (не спиннер на весь экран); `isFetching` — ненавязчивый индикатор поверх старых данных |
| empty | отдельные тексты для «заказов ещё нет» и «ничего не найдено по фильтрам» + кнопка сброса |
| error | сообщение + «Повторить»; сетевые ошибки отделены от 5xx; ErrorBoundary на роут |
| validation (400/422) | ошибки раскладываются по полям формы (по `details[].path`), а не одним тостом |
| business (409) | человекочитаемый текст: «Курьер Иван уже везёт 3 заказа», «Из статуса picked_up нельзя отменить» |
| **conflict (409 VERSION_CONFLICT)** | баннер «Заказ изменён другим оператором», показ *что именно* изменилось (было/стало), кнопки «Обновить и посмотреть» / «Применить моё изменение поверх»; форма не сбрасывается молча, старое значение не отправляется повторно автоматически |
| success | тост + инвалидация кэша (`orders`, `order:id`, `order:id:audit`, `couriers`) |

### 7.3 Технические требования фронта

* TanStack Query: `queryKey` включает все параметры фильтра; `keepPreviousData` для плавной пагинации;
  `staleTime` осознанно выставлен и прокомментирован;
* `version`/ETag хранится вместе с данными заказа и отправляется в `If-Match` — никакого «глобального последнего ETag»;
* единый `apiClient`, который парсит `problem+json` в типизированный `ApiError { status, code, detail, details }`;
  компоненты работают с `code`, а не со строками сообщений;
* типы DTO берутся из `@app/contracts` (или генерируются из OpenAPI) — руками не дублируются;
* доступность: фокус в модалках, `aria-live` для тостов, таблица навигируема с клавиатуры;
* тёмная тема не обязательна, но вёрстка не должна ломаться на 1280px и ниже.

---

## 8. Качество и приёмка

### 8.1 Тесты (минимум)

Unit (без БД):
- [ ] все допустимые/недопустимые переходы стейт-машины;
- [ ] правило отмены, включая границу `ready` → можно, `picked_up` → нельзя;
- [ ] нормализация поискового запроса.

Integration (Testcontainers Postgres, реальные миграции):
- [ ] полный happy-path `new → … → delivered` с проверкой audit log;
- [ ] недопустимый переход → 409 с корректным `code`;
- [ ] версионный конфликт (сценарий A/B из ТЗ);
- [ ] 428 при отсутствии `If-Match`;
- [ ] лимит курьера: 4-е назначение → 409;
- [ ] **параллельные** назначения (5 запросов через `Promise.all`) → лимит не превышен;
- [ ] фильтрация + пагинация: `total` и `items` согласованы;
- [ ] нечёткий поиск находит адрес с опечаткой;
- [ ] атомарность: при ошибке бизнес-правила в БД нет ни изменения заказа, ни записи аудита.

E2E (Playwright, 2–3 сценария):
- [ ] фильтрация списка и переход в карточку;
- [ ] смена статуса и появление записи в audit log;
- [ ] конфликт версий: два таба, второй получает понятную ошибку.

### 8.2 Инженерная гигиена

* `docker compose up` поднимает всё; `pnpm dev` — локальная разработка;
* миграции применяются автоматически при старте api (или отдельной командой — задокументировать);
* ESLint + Prettier + `tsc --noEmit` в CI (GitHub Actions), тесты в CI;
* конфиг только через env, провалидированный Zod при старте (fail-fast);
* никаких `any`, `@ts-ignore`, `console.log` в рабочем коде;
* README: как запустить, схема БД, диаграмма стейт-машины, **принятые решения и допущения**
  (почему optimistic locking, а не pessimistic; почему pg_trgm; почему `ready` требует курьера;
  что бы сделал иначе при 10⁷ заказов).

### 8.3 Definition of Done

Приложение считается готовым, когда:
1. `docker compose up` + seed → в UI видны 200 заказов с разными статусами;
2. фильтр/поиск/сортировка/пагинация работают и отражаются в URL;
3. заказ проходит полный жизненный цикл через UI, каждый шаг виден в audit log;
4. попытка недопустимого перехода даёт понятное сообщение, а не 500;
5. 4-е активное назначение курьеру отклоняется, в UI видно `3/3`;
6. сценарий с двумя вкладками воспроизводит конфликт версий и показывает объяснение;
7. все тесты из 8.1 зелёные.

---

## 9. Как работать над задачей

1. Сначала — `packages/contracts`: enum, граф переходов, DTO, коды ошибок. Это контракт для обеих сторон.
2. Затем — миграции и доменный слой с юнит-тестами (стейт-машина тестируется до первого HTTP-запроса).
3. Затем — сервисы с транзакциями и блокировками + интеграционные тесты конкурентности.
4. Затем — роуты и OpenAPI.
5. Затем — seed (он же smoke-тест домена).
6. Затем — фронт: сначала список, потом карточка, потом обработка конфликтов.
7. В конце — e2e и README.

Каждое неочевидное решение фиксируй в README коротким ADR (контекст → решение → альтернативы → следствия).
Если требование допускает две трактовки — выбери одну, реализуй и явно опиши выбор; не оставляй TODO.
