import { ORDER_CHANGED_EVENT, isOrderChangeEvent, type OrderChangeEvent } from '@food/contracts';
import { useEffect, useRef } from 'react';

const BASE_URL = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1';

export interface OrderStreamOptions {
  /** Подписка только на один заказ. Без него приходят изменения всех заказов. */
  orderId?: string;
  onChange: (event: OrderChangeEvent) => void;
  /** Вызывается при (пере)подключении: за время обрыва события могли пройти мимо. */
  onReconnect?: () => void;
  enabled?: boolean;
}

/**
 * Подписка на изменения заказов через Server-Sent Events.
 *
 * Переподключение делает сам браузер по интервалу, который прислал сервер
 * (`retry:`), поэтому своей логики повторов здесь нет — только уведомление
 * о том, что связь восстановилась и данные надо перечитать.
 */
export function useOrderStream({
  orderId,
  onChange,
  onReconnect,
  enabled = true,
}: OrderStreamOptions): void {
  // Колбэки держим в ref: иначе новая ссылка на функцию пересоздавала бы
  // соединение на каждый рендер.
  const changeRef = useRef(onChange);
  const reconnectRef = useRef(onReconnect);

  useEffect(() => {
    changeRef.current = onChange;
    reconnectRef.current = onReconnect;
  }, [onChange, onReconnect]);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') {
      return;
    }

    const url = `${BASE_URL}/orders/stream${orderId ? `?orderId=${encodeURIComponent(orderId)}` : ''}`;
    const source = new EventSource(url);

    // Первое открытие тоже считается переподключением: данные могли устареть,
    // пока страница грузилась.
    const handleOpen = (): void => reconnectRef.current?.();

    const handleChange = (message: MessageEvent<string>): void => {
      try {
        const parsed: unknown = JSON.parse(message.data);
        if (isOrderChangeEvent(parsed)) {
          changeRef.current(parsed);
        }
      } catch {
        // Повреждённый кадр не повод рвать подписку.
      }
    };

    source.addEventListener('open', handleOpen);
    source.addEventListener(ORDER_CHANGED_EVENT, handleChange as EventListener);

    return () => {
      source.removeEventListener('open', handleOpen);
      source.removeEventListener(ORDER_CHANGED_EVENT, handleChange as EventListener);
      source.close();
    };
  }, [orderId, enabled]);
}
