import { EventEmitter } from 'node:events';
import type { OrderChangeEvent } from '@food/contracts';
import pg from 'pg';
import type { AppConfig } from '../config.js';

export const ORDER_CHANGED_CHANNEL = 'order_changed';

/** Форма события общая для сервера и клиента — объявлена в @food/contracts. */
export type OrderChangedEvent = OrderChangeEvent;

interface Logger {
  info: (data: object, message: string) => void;
  warn: (data: object, message: string) => void;
}

export interface OrderEventsOptions {
  connectionString: string;
  logger?: Logger;
  /** Задержки переподключения, мс. Растут до последнего значения. */
  reconnectDelaysMs?: number[];
}

const DEFAULT_RECONNECT_DELAYS = [500, 1_000, 2_000, 5_000, 10_000];

/**
 * Подписчик на изменения заказов.
 *
 * Держит отдельное соединение, а не соединение из пула: LISTEN живёт ровно
 * столько, сколько живёт сессия, а пул возвращает соединения другим запросам
 * и может их закрывать.
 */
export class OrderEvents extends EventEmitter {
  private client: pg.Client | undefined;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;

  private readonly connectionString: string;
  private readonly logger: Logger | undefined;
  private readonly delays: number[];

  constructor(options: OrderEventsOptions) {
    super();
    // Подписчиков может быть много — по одному на каждое открытое SSE-соединение.
    this.setMaxListeners(0);
    this.connectionString = options.connectionString;
    this.logger = options.logger;
    this.delays = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    const client = this.client;
    this.client = undefined;
    if (client) {
      await client.end().catch(() => undefined);
    }
    this.removeAllListeners('order-changed');
  }

  get connected(): boolean {
    return this.client !== undefined;
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({
      connectionString: this.connectionString,
      application_name: 'food-order-events',
    });

    client.on('notification', (message) => {
      if (message.channel !== ORDER_CHANGED_CHANNEL || !message.payload) return;

      try {
        this.emit('order-changed', JSON.parse(message.payload) as OrderChangedEvent);
      } catch (error) {
        this.logger?.warn({ err: error }, 'не удалось разобрать уведомление об изменении заказа');
      }
    });

    // Обрыв соединения не должен ронять процесс: переподключаемся.
    client.on('error', (error) => {
      this.logger?.warn({ err: error }, 'соединение подписки разорвано');
      this.client = undefined;
      void client.end().catch(() => undefined);
      this.scheduleReconnect();
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${ORDER_CHANGED_CHANNEL}`);
      this.client = client;
      this.attempt = 0;
      this.logger?.info({ channel: ORDER_CHANGED_CHANNEL }, 'подписка на изменения заказов активна');
    } catch (error) {
      await client.end().catch(() => undefined);
      this.logger?.warn({ err: error }, 'не удалось подписаться на изменения заказов');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    const delay = this.delays[Math.min(this.attempt, this.delays.length - 1)]!;
    this.attempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
    // Таймер не должен удерживать процесс при завершении.
    this.reconnectTimer.unref();
  }
}

export function createOrderEvents(config: AppConfig, logger?: Logger): OrderEvents {
  return new OrderEvents(
    logger
      ? { connectionString: config.DATABASE_URL, logger }
      : { connectionString: config.DATABASE_URL },
  );
}
