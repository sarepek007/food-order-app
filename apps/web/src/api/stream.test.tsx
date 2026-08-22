import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderChangeEvent } from '@food/contracts';
import { FakeEventSource, installFakeEventSource, uninstallFakeEventSource } from '@/test/event-source';
import { useOrderStream } from './stream';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function event(overrides: Partial<OrderChangeEvent> = {}): OrderChangeEvent {
  return {
    orderId: ORDER_ID,
    action: 'STATUS_CHANGED',
    oldStatus: 'new',
    newStatus: 'accepted',
    version: 2,
    actor: 'Анна',
    at: '2026-05-21T12:00:00.000Z',
    ...overrides,
  };
}

function Subscriber(props: Parameters<typeof useOrderStream>[0]) {
  useOrderStream(props);
  return null;
}

beforeEach(() => {
  installFakeEventSource();
});

afterEach(() => {
  uninstallFakeEventSource();
});

describe('useOrderStream', () => {
  it('подписывается на общий поток без указания заказа', () => {
    render(<Subscriber onChange={vi.fn()} />);
    expect(FakeEventSource.last?.url).toBe('/api/v1/orders/stream');
  });

  it('ограничивает подписку конкретным заказом', () => {
    render(<Subscriber orderId={ORDER_ID} onChange={vi.fn()} />);
    expect(FakeEventSource.last?.url).toContain(`orderId=${ORDER_ID}`);
  });

  it('передаёт разобранное событие в обработчик', async () => {
    const onChange = vi.fn();
    render(<Subscriber onChange={onChange} />);

    act(() => FakeEventSource.last!.emit('order-changed', event()));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(event()));
  });

  it('игнорирует повреждённый кадр, не разрывая подписку', async () => {
    const onChange = vi.fn();
    render(<Subscriber onChange={onChange} />);

    const source = FakeEventSource.last!;
    act(() => {
      for (const listener of source.listeners.get('order-changed') ?? []) {
        listener(new MessageEvent('order-changed', { data: 'не json' }));
      }
    });
    act(() => source.emit('order-changed', event()));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(source.closed).toBe(false);
  });

  it('игнорирует событие неизвестной формы', async () => {
    const onChange = vi.fn();
    render(<Subscriber onChange={onChange} />);

    act(() => FakeEventSource.last!.emit('order-changed', { какое: 'то' }));

    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
  });

  it('сообщает о переподключении', async () => {
    const onReconnect = vi.fn();
    render(<Subscriber onChange={vi.fn()} onReconnect={onReconnect} />);

    act(() => FakeEventSource.last!.emitOpen());

    await waitFor(() => expect(onReconnect).toHaveBeenCalled());
  });

  it('закрывает соединение при размонтировании', () => {
    const { unmount } = render(<Subscriber onChange={vi.fn()} />);
    const source = FakeEventSource.last!;

    unmount();
    expect(source.closed).toBe(true);
  });

  it('не подключается, когда подписка выключена', () => {
    render(<Subscriber onChange={vi.fn()} enabled={false} />);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('не пересоздаёт соединение при смене обработчика', () => {
    const { rerender } = render(<Subscriber onChange={vi.fn()} />);
    rerender(<Subscriber onChange={vi.fn()} />);

    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
