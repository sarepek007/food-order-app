import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  ORDER_STATUSES,
  allowedTransitions,
  canTransition,
  isCancellable,
  isOrderStatus,
  isTerminal,
  nextProgressStatuses,
  occupiesCourierSlot,
  orderStatusLabel,
  requiresCourier,
  type OrderStatus,
} from './order-status.js';

/**
 * Таблица переходов продублирована здесь намеренно и независимо от исходника:
 * тест должен ломаться при случайном изменении графа, а не повторять его.
 */
const EXPECTED: Record<OrderStatus, OrderStatus[]> = {
  new: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['picked_up', 'cancelled'],
  picked_up: ['delivered'],
  delivered: [],
  cancelled: [],
};

describe('граф переходов', () => {
  it('покрывает все статусы', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it.each(ORDER_STATUSES)('из %s допускает ровно ожидаемые переходы', (from) => {
    expect([...allowedTransitions(from)].sort()).toEqual([...EXPECTED[from]].sort());
  });

  it('разрешает только перечисленные пары и запрещает все остальные', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        expect(canTransition(from, to)).toBe(EXPECTED[from].includes(to));
      }
    }
  });

  it('не допускает переход статуса в самого себя', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('не имеет переходов, ведущих обратно по конвейеру', () => {
    const order: OrderStatus[] = ['new', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered'];
    for (const [index, from] of order.entries()) {
      for (const to of allowedTransitions(from)) {
        if (to === 'cancelled') continue;
        expect(order.indexOf(to)).toBeGreaterThan(index);
      }
    }
  });

  it('nextProgressStatuses исключает отмену', () => {
    expect(nextProgressStatuses('new')).toEqual(['accepted']);
    expect(nextProgressStatuses('ready')).toEqual(['picked_up']);
    expect(nextProgressStatuses('picked_up')).toEqual(['delivered']);
    expect(nextProgressStatuses('delivered')).toEqual([]);
  });

  it('таблица переходов заморожена от мутаций', () => {
    expect(Object.isFrozen(ALLOWED_TRANSITIONS)).toBe(true);
  });
});

describe('свойства статусов', () => {
  it('терминальны только delivered и cancelled', () => {
    const terminal = ORDER_STATUSES.filter(isTerminal);
    expect(terminal).toEqual(['delivered', 'cancelled']);
  });

  it('терминальные статусы не имеют исходящих переходов', () => {
    for (const status of ORDER_STATUSES.filter(isTerminal)) {
      expect(allowedTransitions(status)).toHaveLength(0);
    }
  });

  it('отменяемы статусы до picked_up включительно ready', () => {
    expect(ORDER_STATUSES.filter(isCancellable)).toEqual(['new', 'accepted', 'preparing', 'ready']);
  });

  it('после передачи курьеру отмена невозможна — ключевая граница из ТЗ', () => {
    expect(isCancellable('ready')).toBe(true);
    expect(isCancellable('picked_up')).toBe(false);
    expect(canTransition('picked_up', 'cancelled')).toBe(false);
  });

  it('слот курьера занимают только ready и picked_up', () => {
    expect(ORDER_STATUSES.filter(occupiesCourierSlot)).toEqual(['ready', 'picked_up']);
  });

  it('курьер обязателен начиная с ready', () => {
    expect(ORDER_STATUSES.filter(requiresCourier)).toEqual(['ready', 'picked_up', 'delivered']);
    expect(requiresCourier('preparing')).toBe(false);
  });

  it('каждый статус имеет человекочитаемое название', () => {
    for (const status of ORDER_STATUSES) {
      expect(orderStatusLabel(status)).toMatch(/\p{L}/u);
    }
  });
});

describe('isOrderStatus', () => {
  it.each(ORDER_STATUSES)('принимает %s', (status) => {
    expect(isOrderStatus(status)).toBe(true);
  });

  it.each([['NEW'], ['done'], [''], [null], [undefined], [42], [{}]])(
    'отклоняет %s',
    (value) => {
      expect(isOrderStatus(value)).toBe(false);
    },
  );
});
