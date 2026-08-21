import {
  assignCourierSchema,
  auditListResponseSchema,
  auditQuerySchema,
  cancelOrderSchema,
  changeStatusSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  orderDetailsSchema,
  orderIdParamsSchema,
  orderListResponseSchema,
  unassignCourierSchema,
  type OrderDetails,
} from '@food/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idempotencyFrom } from '../http/idempotency.js';
import { etagOf, resolveExpectedVersion } from '../http/preconditions.js';
import type { OrderService } from '../services/order-service.js';

interface OrdersRouteOptions {
  service: OrderService;
}

/**
 * Роуты не содержат бизнес-логики: разбирают запрос, вызывают сервис,
 * проставляют ETag. Ошибки уходят в общий обработчик.
 */
export const ordersRoutes: FastifyPluginAsyncZod<OrdersRouteOptions> = async (app, options) => {
  const { service } = options;

  /** Версия, на которой клиент строил решение: If-Match или поле version в теле. */
  async function expectedVersionFor(
    request: Parameters<typeof resolveExpectedVersion>[0],
    id: string,
    bodyVersion: number | undefined,
  ): Promise<number> {
    const expected = resolveExpectedVersion(request, bodyVersion);
    if (!expected.force) {
      return expected.value!;
    }
    // If-Match: * — «применить поверх текущего состояния». Если состояние
    // изменится между этим чтением и записью, клиент всё равно получит 409.
    const current = await service.getById(id);
    return current.version;
  }

  function sendOrder(reply: { header: (k: string, v: string) => unknown }, order: OrderDetails): OrderDetails {
    reply.header('ETag', etagOf(order.version));
    return order;
  }

  app.get(
    '/orders',
    {
      schema: {
        summary: 'Список заказов',
        description:
          'Фильтрация по статусу, ресторану и курьеру, поиск по адресу с опечатками, сортировка и пагинация.',
        tags: ['orders'],
        querystring: listOrdersQuerySchema,
        response: { 200: orderListResponseSchema },
      },
    },
    async (request) => service.list(request.query),
  );

  app.post(
    '/orders',
    {
      schema: {
        summary: 'Создать заказ',
        tags: ['orders'],
        body: createOrderSchema,
        response: { 201: orderDetailsSchema },
      },
    },
    async (request, reply) => {
      const order = await service.create(
        request.body,
        { actor: request.actor },
        idempotencyFrom(request, reply),
      );
      reply.status(201);
      reply.header('Location', `/api/v1/orders/${order.id}`);
      return sendOrder(reply, order);
    },
  );

  app.get(
    '/orders/:id',
    {
      schema: {
        summary: 'Карточка заказа',
        description: 'Возвращает ETag с версией заказа — его нужно вернуть в If-Match при изменении.',
        tags: ['orders'],
        params: orderIdParamsSchema,
        response: { 200: orderDetailsSchema },
      },
    },
    async (request, reply) => sendOrder(reply, await service.getById(request.params.id)),
  );

  app.get(
    '/orders/:id/audit',
    {
      schema: {
        summary: 'Журнал изменений заказа',
        tags: ['orders'],
        params: orderIdParamsSchema,
        querystring: auditQuerySchema,
        response: { 200: auditListResponseSchema },
      },
    },
    async (request) => service.getAudit(request.params.id, request.query),
  );

  app.patch(
    '/orders/:id/status',
    {
      schema: {
        summary: 'Изменить статус заказа',
        description:
          'Отмена выполняется отдельным эндпоинтом POST /orders/:id/cancel, потому что требует причины.',
        tags: ['orders'],
        params: orderIdParamsSchema,
        body: changeStatusSchema,
        response: { 200: orderDetailsSchema },
      },
    },
    async (request, reply) => {
      const version = await expectedVersionFor(request, request.params.id, request.body.version);
      const order = await service.changeStatus(
        request.params.id,
        request.body,
        version,
        { actor: request.actor },
        idempotencyFrom(request, reply),
      );
      return sendOrder(reply, order);
    },
  );

  app.put(
    '/orders/:id/courier',
    {
      schema: {
        summary: 'Назначить или сменить курьера',
        description: 'Отклоняется, если у курьера уже максимум активных доставок.',
        tags: ['orders'],
        params: orderIdParamsSchema,
        body: assignCourierSchema,
        response: { 200: orderDetailsSchema },
      },
    },
    async (request, reply) => {
      const version = await expectedVersionFor(request, request.params.id, request.body.version);
      const order = await service.assignCourier(
        request.params.id,
        request.body.courierId,
        version,
        { actor: request.actor },
        idempotencyFrom(request, reply),
      );
      return sendOrder(reply, order);
    },
  );

  app.delete(
    '/orders/:id/courier',
    {
      schema: {
        summary: 'Снять курьера с заказа',
        tags: ['orders'],
        params: orderIdParamsSchema,
        // Fastify передаёт null, когда тела нет вовсе, поэтому nullish, а не optional.
        body: unassignCourierSchema.nullish(),
        response: { 200: orderDetailsSchema },
      },
    },
    async (request, reply) => {
      const version = await expectedVersionFor(request, request.params.id, request.body?.version);
      const order = await service.unassignCourier(
        request.params.id,
        version,
        { actor: request.actor },
        idempotencyFrom(request, reply),
      );
      return sendOrder(reply, order);
    },
  );

  app.post(
    '/orders/:id/cancel',
    {
      schema: {
        summary: 'Отменить заказ',
        description: 'Доступно до передачи заказа курьеру. Причина обязательна.',
        tags: ['orders'],
        params: orderIdParamsSchema,
        body: cancelOrderSchema,
        response: { 200: orderDetailsSchema },
      },
    },
    async (request, reply) => {
      const version = await expectedVersionFor(request, request.params.id, request.body.version);
      const order = await service.cancel(
        request.params.id,
        request.body,
        version,
        { actor: request.actor },
        idempotencyFrom(request, reply),
      );
      return sendOrder(reply, order);
    },
  );
};
