import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OrderChangedEvent, OrderEvents } from '../realtime/order-events.js';

interface StreamRouteOptions {
  events: OrderEvents;
}

const streamQuerySchema = z
  .object({
    /** Подписка только на конкретные заказы: карточке не нужен весь поток. */
    orderId: z
      .preprocess((value) => {
        if (value === undefined || value === '') return undefined;
        const raw = Array.isArray(value) ? value : [value];
        return raw.flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : [entry]));
      }, z.array(z.string().uuid()).optional()),
  })
  .strict();

/** Пауза между служебными сообщениями: прокси закрывают «молчащие» соединения. */
const HEARTBEAT_MS = 20_000;

/** Через столько клиент попробует переподключиться после обрыва. */
const CLIENT_RETRY_MS = 3_000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Поток изменений заказов (Server-Sent Events).
 *
 * SSE, а не WebSocket: поток односторонний, переподключение браузер делает
 * сам, и всё работает поверх обычного HTTP — без отдельного протокола
 * в прокси и балансировщике.
 */
export const streamRoutes: FastifyPluginAsyncZod<StreamRouteOptions> = async (app, options) => {
  const open = new Set<() => void>();

  // Незакрытые соединения удерживали бы процесс при остановке сервиса.
  app.addHook('onClose', async () => {
    for (const close of open) close();
    open.clear();
  });

  app.get(
    '/orders/stream',
    {
      schema: {
        summary: 'Поток изменений заказов',
        description:
          'Server-Sent Events. Событие order-changed отправляется после фиксации изменения в БД. ' +
          'Необязательный параметр orderId ограничивает подписку конкретными заказами.',
        tags: ['orders'],
        querystring: streamQuerySchema,
      },
    },
    (request, reply) => {
      const filter = request.query.orderId;
      const watched = filter && filter.length > 0 ? new Set(filter) : undefined;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Без этого nginx буферизует ответ и поток «залипает».
        'X-Accel-Buffering': 'no',
      });
      // Дальше ответом управляем вручную: Fastify не должен его закрывать.
      reply.hijack();

      const write = (chunk: string): void => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(chunk);
        }
      };

      write(`retry: ${CLIENT_RETRY_MS}\n\n`);
      write(sseFrame('ready', { watched: watched ? [...watched] : 'all' }));

      const onChange = (event: OrderChangedEvent): void => {
        if (watched && !watched.has(event.orderId)) return;
        write(sseFrame('order-changed', event));
      };

      const heartbeat = setInterval(() => write(': heartbeat\n\n'), HEARTBEAT_MS);
      heartbeat.unref();

      const close = (): void => {
        if (!open.has(close)) return;
        open.delete(close);
        clearInterval(heartbeat);
        options.events.off('order-changed', onChange);
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      };

      open.add(close);
      options.events.on('order-changed', onChange);
      request.raw.on('close', close);
      request.raw.on('error', close);
    },
  );
};
