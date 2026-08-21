import { courierSchema, restaurantSchema } from '@food/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OrderService } from '../services/order-service.js';

interface ReferenceRouteOptions {
  service: OrderService;
}

/** Справочники для фильтров и форм. Объёмы малы, пагинация не нужна. */
export const referenceRoutes: FastifyPluginAsyncZod<ReferenceRouteOptions> = async (app, options) => {
  const { service } = options;

  app.get(
    '/restaurants',
    {
      schema: {
        summary: 'Справочник ресторанов',
        tags: ['reference'],
        response: { 200: z.array(restaurantSchema) },
      },
    },
    async () => service.listRestaurants(),
  );

  app.get(
    '/couriers',
    {
      schema: {
        summary: 'Справочник курьеров с текущей загрузкой',
        description: 'activeOrdersCount — заказы в статусах ready и picked_up; hasCapacity учитывает лимит.',
        tags: ['reference'],
        response: { 200: z.array(courierSchema) },
      },
    },
    async () => service.listCouriers(),
  );
};
