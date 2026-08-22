import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config.js';
import type { DbPool } from './db/pool.js';
import { registerActorContext } from './plugins/actor-context.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import type { OrderEvents } from './realtime/order-events.js';
import { healthRoutes } from './routes/health.js';
import { ordersRoutes } from './routes/orders.js';
import { referenceRoutes } from './routes/reference.js';
import { streamRoutes } from './routes/stream.js';
import { OrderService } from './services/order-service.js';

export const API_PREFIX = '/api/v1';

export interface BuildAppOptions {
  config: AppConfig;
  pool: DbPool;
  /** Источник событий для потока изменений; без него поток не регистрируется. */
  events?: OrderEvents;
}

export async function buildApp({ config, pool, events }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // В разработке лог читают люди, в проде — машины.
      ...(config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : {}),
    },
    // Клиент может задать свой идентификатор запроса — он попадёт в problem+json.
    requestIdHeader: 'x-request-id',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  /**
   * Пустое тело при объявленном Content-Type — это отсутствие тела.
   *
   * Разбор по умолчанию отвергает такой запрос с «Body cannot be empty»,
   * хотя `DELETE /orders/:id/courier` тела и не требует. Многие HTTP-клиенты
   * выставляют Content-Type всегда, и получать за это 400 они не должны.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      const raw = typeof body === 'string' ? body.trim() : '';

      if (raw === '') {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(raw));
      } catch {
        // Некорректный JSON остаётся ошибкой запроса, а не сбоем сервера.
        const error = new Error('Тело запроса не является корректным JSON') as Error & {
          statusCode: number;
        };
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );

  registerErrorHandler(app);
  registerActorContext(app);

  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',').map((value) => value.trim()),
    // Без этого браузер не увидит ETag и не сможет отправить If-Match.
    exposedHeaders: ['ETag', 'Location', 'X-Request-Id', 'Idempotency-Replayed'],
    allowedHeaders: [
      'Content-Type',
      'If-Match',
      'X-Actor',
      'X-Request-Id',
      'Idempotency-Key',
    ],
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Food Order Ops API',
        description:
          'Операционная консоль заказов. Изменяющие запросы требуют If-Match с версией заказа: ' +
          'это защищает от молчаливой перезаписи чужих изменений.',
        version: '1.0.0',
      },
      servers: [{ url: API_PREFIX }],
      tags: [
        { name: 'orders', description: 'Заказы' },
        { name: 'reference', description: 'Справочники' },
        { name: 'system', description: 'Служебное' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, { routePrefix: '/docs' });

  const service = new OrderService(pool, {
    courierActiveLimit: config.COURIER_ACTIVE_LIMIT,
    searchSimilarityThreshold: config.SEARCH_SIMILARITY_THRESHOLD,
    statusSla: config.statusSla,
  });

  await app.register(
    async (instance) => {
      await instance.register(ordersRoutes, { service });
      await instance.register(referenceRoutes, { service });
      await instance.register(healthRoutes, { pool });
      if (events) {
        await instance.register(streamRoutes, { events });
      }
    },
    { prefix: API_PREFIX },
  );

  return app;
}
