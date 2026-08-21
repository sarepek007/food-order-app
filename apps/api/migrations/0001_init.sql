-- =====================================================================
-- 0001 · Базовая схема: справочники, заказы, журнал изменений
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- Жизненный цикл заказа. Значения совпадают с ORDER_STATUSES
-- из packages/contracts — это часть общего контракта.
-- ---------------------------------------------------------------------
CREATE TYPE order_status AS ENUM (
    'new',
    'accepted',
    'preparing',
    'ready',
    'picked_up',
    'delivered',
    'cancelled'
);

CREATE TYPE audit_action AS ENUM (
    'ORDER_CREATED',
    'STATUS_CHANGED',
    'COURIER_ASSIGNED',
    'COURIER_CHANGED',
    'COURIER_UNASSIGNED',
    'ORDER_CANCELLED'
);

-- ---------------------------------------------------------------------
-- Нормализация адреса для нечёткого поиска.
--
-- Ровно повторяет normalizeSearchQuery() из packages/contracts/src/search.ts:
-- нижний регистр, ё → е, пунктуация в пробелы, схлопывание пробелов.
-- Классы символов заданы явными диапазонами, а не [:alnum:], чтобы результат
-- не зависел от локали кластера.
-- ---------------------------------------------------------------------
CREATE FUNCTION normalize_address(value text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    STRICT
AS $$
SELECT btrim(
               regexp_replace(
                       regexp_replace(
                               translate(lower(value), 'ё', 'е'),
                               '[^a-z0-9а-я\s/-]+', ' ', 'g'
                       ),
                       '\s+', ' ', 'g'
               )
       );
$$;

COMMENT ON FUNCTION normalize_address(text) IS
    'Приведение адреса к канонической форме для триграммного поиска. Зеркалит normalizeSearchQuery() в @food/contracts.';

-- ---------------------------------------------------------------------
-- Справочники
-- ---------------------------------------------------------------------
CREATE TABLE restaurants
(
    id         uuid PRIMARY KEY     DEFAULT gen_random_uuid(),
    name       text        NOT NULL CHECK (length(btrim(name)) > 0),
    address    text        NOT NULL CHECK (length(btrim(address)) > 0),
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE couriers
(
    id         uuid PRIMARY KEY     DEFAULT gen_random_uuid(),
    name       text        NOT NULL CHECK (length(btrim(name)) > 0),
    phone      text,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Заказы
-- ---------------------------------------------------------------------
CREATE TABLE orders
(
    id                          uuid PRIMARY KEY      DEFAULT gen_random_uuid(),
    public_number               bigint GENERATED ALWAYS AS IDENTITY,
    status                      order_status NOT NULL DEFAULT 'new',
    customer_name               text         NOT NULL CHECK (length(btrim(customer_name)) >= 2),
    customer_phone              text,
    restaurant_id               uuid         NOT NULL REFERENCES restaurants (id),
    courier_id                  uuid         REFERENCES couriers (id),
    delivery_address            text         NOT NULL CHECK (length(btrim(delivery_address)) >= 5),
    delivery_address_normalized text GENERATED ALWAYS AS (normalize_address(delivery_address)) STORED,
    total_amount                numeric(12, 2) NOT NULL CHECK (total_amount >= 0),
    currency                    char(3)      NOT NULL DEFAULT 'RUB',
    cancel_reason               text,
    version                     integer      NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at                  timestamptz  NOT NULL DEFAULT now(),
    updated_at                  timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT orders_public_number_unique UNIQUE (public_number),

    -- Доменное правило «с ready заказ обязан иметь исполнителя» продублировано
    -- в БД: сервисный слой не единственный писатель (есть seed и миграции данных).
    CONSTRAINT orders_courier_required_from_ready CHECK (
        status NOT IN ('ready', 'picked_up', 'delivered') OR courier_id IS NOT NULL
        ),

    -- Отмена без причины не имеет смысла для операционного разбора.
    CONSTRAINT orders_cancel_reason_required CHECK (
        status <> 'cancelled' OR (cancel_reason IS NOT NULL AND length(btrim(cancel_reason)) > 0)
        ),

    CONSTRAINT orders_created_before_updated CHECK (updated_at >= created_at)
);

COMMENT ON COLUMN orders.version IS
    'Счётчик оптимистической блокировки. Инкрементируется триггером, приложение его не выставляет.';
COMMENT ON COLUMN orders.delivery_address_normalized IS
    'Генерируемая колонка для GIN/trgm-поиска. Не показывается пользователю.';

-- ---------------------------------------------------------------------
-- Журнал изменений (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE order_audit_log
(
    id             bigserial PRIMARY KEY,
    -- Без ON DELETE CASCADE: заказы не удаляются, а журнал неизменяем —
    -- каскад противоречил бы триггеру, запрещающему DELETE.
    order_id       uuid         NOT NULL REFERENCES orders (id),
    action         audit_action NOT NULL,
    old_status     order_status,
    new_status     order_status,
    old_courier_id uuid REFERENCES couriers (id),
    new_courier_id uuid REFERENCES couriers (id),
    comment        text,
    actor          text         NOT NULL DEFAULT 'system' CHECK (length(btrim(actor)) > 0),
    created_at     timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE order_audit_log IS
    'Журнал изменений заказа. Только добавление: UPDATE и DELETE запрещены триггером.';

-- ---------------------------------------------------------------------
-- Индексы
-- ---------------------------------------------------------------------

-- Фильтры списка заказов.
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_restaurant ON orders (restaurant_id);
CREATE INDEX idx_orders_courier ON orders (courier_id);

-- Сортировка по умолчанию и постраничный обход: id как тай-брейкер даёт
-- устойчивый порядок при одинаковых временных метках.
CREATE INDEX idx_orders_created_at_id ON orders (created_at DESC, id DESC);
CREATE INDEX idx_orders_updated_at_id ON orders (updated_at DESC, id DESC);

-- Подсчёт загрузки курьера. Частичный индекс: активных заказов на порядок
-- меньше, чем всех, и именно они читаются под блокировкой при назначении.
CREATE INDEX idx_orders_active_by_courier ON orders (courier_id)
    WHERE status IN ('ready', 'picked_up');

-- Нечёткий поиск по адресу.
CREATE INDEX idx_orders_address_trgm ON orders USING gin (delivery_address_normalized gin_trgm_ops);

-- Журнал заказа читается страницами в обратном хронологическом порядке.
CREATE INDEX idx_audit_order_created ON order_audit_log (order_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------
-- Триггеры
-- ---------------------------------------------------------------------

-- Версия и updated_at — ответственность БД, а не приложения: любой писатель
-- (API, seed, ручной SQL) обязан получать корректный счётчик конфликтов.
CREATE FUNCTION orders_bump_version() RETURNS trigger
    LANGUAGE plpgsql
AS $$
DECLARE
    -- Служебные колонки исключаются из сравнения:
    --   version/updated_at меняет сам триггер;
    --   delivery_address_normalized — STORED-генерируемая колонка, и в
    --   BEFORE-триггере её значение в NEW ещё не вычислено (NULL), поэтому
    --   прямое сравнение NEW и OLD давало бы «изменение» на каждом UPDATE.
    ignored CONSTANT text[] := ARRAY ['version', 'updated_at', 'delivery_address_normalized'];
BEGIN
    IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
        NEW.version := OLD.version + 1;
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION orders_bump_version() IS
    'Инкремент версии и updated_at при реальном изменении данных заказа. Холостой UPDATE версию не двигает.';

CREATE TRIGGER trg_orders_bump_version
    BEFORE UPDATE
    ON orders
    FOR EACH ROW
EXECUTE FUNCTION orders_bump_version();

-- Журнал неизменяем: правка истории лишает её доказательной силы.
CREATE FUNCTION reject_audit_mutation() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'order_audit_log is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE OR DELETE
    ON order_audit_log
    FOR EACH ROW
EXECUTE FUNCTION reject_audit_mutation();
