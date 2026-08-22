-- =====================================================================
-- 0005 · Публикация изменений заказа
--
-- Оповещение вешается на журнал, а не на прикладной код: каждое значимое
-- изменение и так пишет запись в order_audit_log в той же транзакции.
-- Так публикатор не может «забыть» отправить событие, а NOTIFY в Postgres
-- транзакционен — подписчик получит уведомление только после COMMIT.
-- =====================================================================

CREATE FUNCTION notify_order_changed() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    -- Полезная нагрузка намеренно маленькая: лимит NOTIFY — 8000 байт,
    -- и подписчику нужен лишь повод перечитать заказ.
    PERFORM pg_notify(
            'order_changed',
            json_build_object(
                    'orderId', NEW.order_id,
                    'action', NEW.action,
                    'oldStatus', NEW.old_status,
                    'newStatus', NEW.new_status,
                    'version', NEW.order_version,
                    'actor', NEW.actor,
                    'at', NEW.created_at
            )::text
            );
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION notify_order_changed() IS
    'Публикует изменение заказа в канал order_changed. NOTIFY транзакционен: событие уходит только при COMMIT.';

CREATE TRIGGER trg_audit_notify_order_changed
    AFTER INSERT
    ON order_audit_log
    FOR EACH ROW
EXECUTE FUNCTION notify_order_changed();
