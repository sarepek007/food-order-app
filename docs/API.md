# REST API

Базовый путь — `/api/v1`. Интерактивная документация: `http://localhost:3000/docs`
(OpenAPI-схема генерируется из тех же Zod-схем, что валидируют запросы).
Готовые сценарии для HTTP-клиента WebStorm: [apps/api/requests.http](../apps/api/requests.http).

## Эндпоинты

| Метод | Путь | Назначение |
|-------|------|------------|
| `GET` | `/orders` | список: фильтры, поиск, сортировка, пагинация |
| `POST` | `/orders` | создать заказ |
| `GET` | `/orders/{id}` | карточка заказа (+ `ETag`) |
| `GET` | `/orders/{id}/audit` | журнал изменений |
| `PATCH` | `/orders/{id}/status` | перевести в следующий статус |
| `PUT` | `/orders/{id}/courier` | назначить или сменить курьера |
| `DELETE` | `/orders/{id}/courier` | снять курьера |
| `POST` | `/orders/{id}/cancel` | отменить заказ (нужна причина) |
| `GET` | `/restaurants` | справочник ресторанов |
| `GET` | `/couriers` | справочник курьеров с текущей загрузкой |
| `GET` | `/orders/stream` | поток изменений (Server-Sent Events) |
| `GET` | `/health` | готовность сервиса |

## Заголовки

| Заголовок | Направление | Смысл |
|-----------|-------------|-------|
| `ETag: "7"` | ответ | версия заказа |
| `If-Match: "7"` | запрос | версия, на которой клиент строил решение; обязателен для изменений |
| `If-Match: *` | запрос | применить поверх текущего состояния |
| `X-Actor` | запрос | имя оператора для журнала (UTF-8 или процентное кодирование) |
| `Idempotency-Key` | запрос | делает мутацию повторяемой: повтор вернёт исходный ответ |
| `Idempotency-Replayed: true` | ответ | результат воспроизведён, изменение не применялось повторно |
| `Idempotency-Key` | запрос | помечает повторяемую мутацию; 8–255 печатаемых ASCII-символов |
| `Idempotency-Replayed: true` | ответ | изменение уже применялось, это воспроизведение |
| `X-Request-Id` | запрос | идентификатор запроса, возвращается в теле ошибки |

Отсутствие `If-Match` (и поля `version` в теле) — **`428 Precondition Required`**.
Молчаливая перезапись чужих изменений невозможна by design.

## Параметры `GET /orders`

```
status=new,accepted        мультивыбор, CSV или повторяющийся параметр
restaurantId=<uuid>        мультивыбор
courierId=<uuid>           мультивыбор
unassigned=true            заказы без курьера
q=<строка>                 нечёткий поиск по адресу
minAmount / maxAmount      диапазон суммы
createdFrom / createdTo    диапазон дат (ISO-8601)
sort=createdAt|updatedAt|totalAmount|status|relevance
order=asc|desc             по умолчанию createdAt desc
page=1&pageSize=25         pageSize не больше 100
```

## Ошибки

Формат — RFC 9457 `application/problem+json` с машиночитаемым `code`.
Клиент ветвится по `code`, а не по тексту.

```json
{
  "type": "https://food-order-app.local/problems/order-version-conflict",
  "title": "Заказ был изменён другим пользователем",
  "status": 409,
  "detail": "Пока вы работали с заказом, его изменил другой пользователь (оператор B): назначен курьер Alex.",
  "code": "ORDER_VERSION_CONFLICT",
  "instance": "/api/v1/orders/.../courier",
  "requestId": "req-42",
  "details": {
    "expectedVersion": 7,
    "actualVersion": 8,
    "changedFields": ["courierId"],
    "changes": ["назначен курьер Alex"],
    "current": { "...": "актуальный заказ целиком" }
  }
}
```

### Коды и статусы

| Код | HTTP | Когда |
|-----|------|-------|
| `VALIDATION_FAILED` | 400 | запрос не прошёл схему; в `details.issues` — пути до полей |
| `ORDER_NOT_FOUND`, `COURIER_NOT_FOUND`, `RESTAURANT_NOT_FOUND` | 404 | сущность не существует |
| `ORDER_INVALID_TRANSITION` | 409 | переход запрещён; в деталях — допустимые статусы |
| `ORDER_NOT_CANCELLABLE` | 409 | заказ уже у курьера |
| `ORDER_TERMINAL` | 409 | заказ доставлен или отменён |
| `ORDER_VERSION_CONFLICT` | 409 | версия устарела; в деталях — что изменилось |
| `COURIER_CAPACITY_EXCEEDED` | 409 | у курьера уже максимум активных доставок |
| `IDEMPOTENCY_KEY_REUSED` | 409 | тот же `Idempotency-Key` с другим запросом |
| `ORDER_COURIER_REQUIRED` | 422 | нельзя перейти в `ready` без курьера |
| `COURIER_INACTIVE`, `RESTAURANT_INACTIVE` | 422 | справочная сущность отключена |
| `IDEMPOTENCY_KEY_REUSED` | 409 | тот же ключ повтора использован для другого запроса |
| `PRECONDITION_REQUIRED` | 428 | не передана версия заказа |
| `INTERNAL_ERROR` | 500 | внутренняя ошибка; детали только в логах |

Разграничение: **400** — синтаксис запроса, **422** — запрос корректен, но
неисполним по данным, **409** — конфликт с текущим состоянием ресурса.

## Повторяемые мутации

Изменяющий запрос можно пометить `Idempotency-Key`. Повтор с тем же ключом
и тем же телом возвращает **исходный ответ**, не применяя изменение второй раз:

```
PATCH /orders/{id}/status   If-Match: "7"   Idempotency-Key: abc12345
    → 200, версия 8

PATCH /orders/{id}/status   If-Match: "7"   Idempotency-Key: abc12345   (повтор)
    → 200, тот же ответ, Idempotency-Replayed: true

PATCH /orders/{id}/status   If-Match: "8"   Idempotency-Key: abc12345   (другое тело)
    → 409 IDEMPOTENCY_KEY_REUSED
```

Без ключа поведение прежнее: повтор упрётся в конфликт версий.
Подробности: [ADR 0012](adr/0012-idempotency.md).

## Поток изменений

```
GET /orders/stream                 → text/event-stream
GET /orders/stream?orderId=<uuid>  → только события этого заказа

event: ready
data: {"watched":"all"}

event: order-changed
data: {"orderId":"...","action":"STATUS_CHANGED","oldStatus":"new",
       "newStatus":"accepted","version":2,"actor":"Анна","at":"..."}
```

Событие отправляется после фиксации транзакции и сообщает повод перечитать
заказ, а не заменяет чтение. Переподключение выполняет браузер.

## Типовой поток изменения

```
GET  /orders/{id}                    → 200, ETag: "7"
PATCH /orders/{id}/status            → If-Match: "7"
    ├─ 200 + ETag: "8"               применено
    ├─ 409 ORDER_VERSION_CONFLICT    кто-то опередил; в теле актуальный заказ
    ├─ 409 ORDER_INVALID_TRANSITION  переход запрещён
    └─ 428 PRECONDITION_REQUIRED     версия не передана
```
