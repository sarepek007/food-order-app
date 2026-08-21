-- =====================================================================
-- 0003 · Время нахождения заказа в текущем статусе
--
-- «Изменён 40 минут назад» не отвечает на главный вопрос операционной
-- команды: заказ висит в preparing 40 минут при нормативе 25? Отдельная
-- отметка времени смены статуса нужна, потому что updated_at двигает любое
-- изменение — например, смена курьера.
-- =====================================================================

ALTER TABLE orders
    ADD COLUMN status_changed_at timestamptz;

-- Восстанавливаем значение по журналу: берём время последнего события,
-- которым заказ пришёл в текущий статус. Журнал append-only, поэтому
-- источник достоверный.
UPDATE orders o
SET status_changed_at = COALESCE(
        (SELECT max(a.created_at)
         FROM order_audit_log a
         WHERE a.order_id = o.id
           AND a.new_status = o.status
           AND a.new_status IS DISTINCT FROM a.old_status),
        o.created_at
                        );

-- Значения по умолчанию нет намеренно: DEFAULT now() расходился бы
-- с created_at при вставке задним числом (импорт, seed, миграция данных).
-- Пропущенное значение подставляет триггер — из даты создания заказа.
ALTER TABLE orders
    ALTER COLUMN status_changed_at SET NOT NULL;

ALTER TABLE orders
    ADD CONSTRAINT orders_status_changed_after_created CHECK (status_changed_at >= created_at);

COMMENT ON COLUMN orders.status_changed_at IS
    'Момент последней смены статуса. Ведётся триггером; приложение его не выставляет.';

-- ---------------------------------------------------------------------
-- Триггер теперь ведёт и отметку смены статуса
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION orders_bump_version() RETURNS trigger
    LANGUAGE plpgsql
AS $$
DECLARE
    -- Производные колонки исключены из сравнения: их ведёт сам триггер,
    -- а delivery_address_normalized в BEFORE-триггере ещё не вычислена.
    ignored CONSTANT text[] := ARRAY [
        'version', 'updated_at', 'status_changed_at', 'delivery_address_normalized'
        ];
BEGIN
    IF (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
        NEW.version := OLD.version + 1;
        NEW.updated_at := now();
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.status_changed_at := now();
    END IF;

    RETURN NEW;
END;
$$;

-- Пропущенная отметка равна дате создания: заказ вошёл в свой первый статус
-- ровно в момент появления. NOT NULL проверяется после BEFORE-триггера,
-- поэтому вставка без значения корректна.
CREATE FUNCTION orders_default_status_changed_at() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.status_changed_at := COALESCE(NEW.status_changed_at, NEW.created_at, now());
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_default_status_changed_at
    BEFORE INSERT
    ON orders
    FOR EACH ROW
EXECUTE FUNCTION orders_default_status_changed_at();

-- Поиск просроченных: «статус X дольше N секунд». Порог зависит от статуса,
-- поэтому запрос — дизъюнкция по статусам, и составной индекс её обслуживает.
CREATE INDEX idx_orders_status_changed_at ON orders (status, status_changed_at);
