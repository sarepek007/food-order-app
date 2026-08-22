/**
 * Подделка EventSource: в jsdom его нет, а подписка на поток —
 * часть поведения, которое нужно проверять.
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly listeners = new Map<string, Set<EventListener>>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  /** Имитирует приход кадра SSE. */
  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  emitOpen(): void {
    for (const listener of this.listeners.get('open') ?? []) {
      listener(new Event('open'));
    }
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }

  static get last(): FakeEventSource | undefined {
    return FakeEventSource.instances.at(-1);
  }
}

export function installFakeEventSource(): void {
  FakeEventSource.reset();
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
}

export function uninstallFakeEventSource(): void {
  delete (globalThis as { EventSource?: unknown }).EventSource;
  FakeEventSource.reset();
}
