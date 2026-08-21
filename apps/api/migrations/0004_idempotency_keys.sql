-- =====================================================================
-- 0004 · Идемпотентность мутаций
--
-- При нестабильной сети клиент не знает, дошёл ли запрос: ответ мог
-- потеряться уже после применения изменения. Повтор без защиты создаёт
-- второй переход и вторую запись в журнале.
--
-- Первичный ключ по key и есть механизм защиты: запись результата идёт
-- в той же транзакции, что и сама мутация, поэтому «применено, но не
-- записано» невозможно.
-- =====================================================================

CREATE TABLE idempotency_keys
(
    key             text PRIMARY KEY CHECK (length(key) BETWEEN 8 AND 255),
    -- Отпечаток запроса: тот же ключ с другим телом — ошибка клиента,
    -- а не повтор, и такой запрос должен быть отклонён.
    request_hash    text        NOT NULL,
    -- Что вернуть при повторе. Ответ хранится целиком, чтобы воспроизведение
    -- не зависело от текущего состояния заказа.
    response_status integer     NOT NULL CHECK (response_status BETWEEN 100 AND 599),
    response_body   jsonb       NOT NULL,
    -- Заказ, которого касалась операция. Только для разбора инцидентов.
    order_id        uuid REFERENCES orders (id),
    actor           text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,

    CONSTRAINT idempotency_expires_after_created CHECK (expires_at > created_at)
);

COMMENT ON TABLE idempotency_keys IS
    'Результаты выполненных мутаций по ключу Idempotency-Key. Записываются в транзакции самой мутации.';

-- Уборка просроченных записей идёт по этому индексу.
CREATE INDEX idx_idempotency_expires_at ON idempotency_keys (expires_at);
