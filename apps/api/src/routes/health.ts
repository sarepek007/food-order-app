import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DbPool } from '../db/pool.js';

interface HealthRouteOptions {
  pool: DbPool;
}

const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  uptimeSeconds: z.number(),
});

/** Readiness: без доступной БД сервис бесполезен, поэтому проверяем соединение. */
export const healthRoutes: FastifyPluginAsyncZod<HealthRouteOptions> = async (app, options) => {
  app.get(
    '/health',
    {
      schema: {
        summary: 'Проверка готовности сервиса',
        tags: ['system'],
        response: { 200: healthSchema, 503: healthSchema },
      },
    },
    async (_request, reply) => {
      const uptimeSeconds = Math.round(process.uptime());
      try {
        await options.pool.query('SELECT 1');
        return { status: 'ok' as const, database: 'up' as const, uptimeSeconds };
      } catch (error) {
        app.log.error({ err: error }, 'проверка БД не прошла');
        reply.status(503);
        return { status: 'degraded' as const, database: 'down' as const, uptimeSeconds };
      }
    },
  );
};
