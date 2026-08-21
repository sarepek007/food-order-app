import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  assignCourierSchema,
  cancelOrderSchema,
  changeStatusSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  moneySchema,
} from './schemas.js';

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const COURIER_ID = '22222222-2222-4222-8222-222222222222';

describe('createOrderSchema', () => {
  const valid = {
    customerName: 'Иван Петров',
    restaurantId: RESTAURANT_ID,
    deliveryAddress: 'ул. Ленина, д. 5',
    totalAmount: '1290.50',
  };

  it('принимает корректный заказ и подставляет валюту по умолчанию', () => {
    const parsed = createOrderSchema.parse(valid);
    expect(parsed.currency).toBe('RUB');
  });

  it('обрезает пробелы в тексте', () => {
    expect(createOrderSchema.parse({ ...valid, customerName: '  Иван  ' }).customerName).toBe('Иван');
  });

  it('отклоняет неизвестные поля — защита от опечаток в клиенте', () => {
    const result = createOrderSchema.safeParse({ ...valid, status: 'delivered' });
    expect(result.success).toBe(false);
  });

  it.each([
    ['слишком короткое имя', { customerName: 'И' }],
    ['короткий адрес', { deliveryAddress: 'ул' }],
    ['не-uuid ресторан', { restaurantId: 'not-a-uuid' }],
    ['отрицательную сумму', { totalAmount: '-10.00' }],
    ['три знака после запятой', { totalAmount: '10.005' }],
    ['телефон из букв', { customerPhone: 'позвоните мне' }],
  ])('отклоняет %s', (_label, patch) => {
    expect(createOrderSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('указывает путь до сбойного поля', () => {
    const result = createOrderSchema.safeParse({ ...valid, totalAmount: 'abc' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['totalAmount']);
  });
});

describe('moneySchema', () => {
  it.each(['0', '10', '10.5', '1290.50'])('принимает %s', (value) => {
    expect(moneySchema.safeParse(value).success).toBe(true);
  });

  it.each(['', '-1', '1,5', '1.234', 'abc'])('отклоняет %s', (value) => {
    expect(moneySchema.safeParse(value).success).toBe(false);
  });
});

describe('changeStatusSchema', () => {
  it('принимает шаг конвейера', () => {
    expect(changeStatusSchema.parse({ status: 'preparing' }).status).toBe('preparing');
  });

  it('не принимает cancelled — отмена делается отдельным эндпоинтом с причиной', () => {
    expect(changeStatusSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
  });

  it('не принимает new — в него нельзя вернуться', () => {
    expect(changeStatusSchema.safeParse({ status: 'new' }).success).toBe(false);
  });
});

describe('cancelOrderSchema', () => {
  it('требует осмысленную причину', () => {
    expect(cancelOrderSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(cancelOrderSchema.safeParse({ reason: 'ок' }).success).toBe(false);
    expect(cancelOrderSchema.safeParse({ reason: 'клиент передумал' }).success).toBe(true);
  });
});

describe('assignCourierSchema', () => {
  it('требует uuid курьера', () => {
    expect(assignCourierSchema.safeParse({ courierId: COURIER_ID }).success).toBe(true);
    expect(assignCourierSchema.safeParse({ courierId: '7' }).success).toBe(false);
  });

  it('принимает version как запасной путь для If-Match', () => {
    expect(assignCourierSchema.parse({ courierId: COURIER_ID, version: 3 }).version).toBe(3);
    expect(assignCourierSchema.safeParse({ courierId: COURIER_ID, version: 0 }).success).toBe(false);
  });
});

describe('listOrdersQuerySchema', () => {
  it('подставляет разумные значения по умолчанию', () => {
    const parsed = listOrdersQuerySchema.parse({});
    expect(parsed).toMatchObject({
      sort: 'createdAt',
      order: 'desc',
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('разбирает статусы из CSV', () => {
    expect(listOrdersQuerySchema.parse({ status: 'new,accepted' }).status).toEqual([
      'new',
      'accepted',
    ]);
  });

  it('разбирает статусы из повторяющихся параметров', () => {
    expect(listOrdersQuerySchema.parse({ status: ['new', 'ready'] }).status).toEqual(['new', 'ready']);
  });

  it('отклоняет несуществующий статус', () => {
    expect(listOrdersQuerySchema.safeParse({ status: 'shipped' }).success).toBe(false);
  });

  it('приводит числа и даты из строк', () => {
    const parsed = listOrdersQuerySchema.parse({
      page: '3',
      pageSize: '10',
      minAmount: '100.5',
      createdFrom: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(10);
    expect(parsed.minAmount).toBe(100.5);
    expect(parsed.createdFrom).toBeInstanceOf(Date);
  });

  it('разбирает overdue как булево', () => {
    expect(listOrdersQuerySchema.parse({ overdue: 'true' }).overdue).toBe(true);
    expect(listOrdersQuerySchema.parse({}).overdue).toBeUndefined();
  });

  it('принимает сортировку по времени в статусе', () => {
    expect(listOrdersQuerySchema.parse({ sort: 'timeInStatus' }).sort).toBe('timeInStatus');
  });

  it('разбирает unassigned как булево', () => {
    expect(listOrdersQuerySchema.parse({ unassigned: 'true' }).unassigned).toBe(true);
    expect(listOrdersQuerySchema.parse({ unassigned: 'false' }).unassigned).toBe(false);
    expect(listOrdersQuerySchema.parse({}).unassigned).toBeUndefined();
  });

  it('ограничивает размер страницы', () => {
    expect(listOrdersQuerySchema.safeParse({ pageSize: String(MAX_PAGE_SIZE) }).success).toBe(true);
    expect(listOrdersQuerySchema.safeParse({ pageSize: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
    expect(listOrdersQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('допускает сортировку только по белому списку — иначе ORDER BY уязвим', () => {
    expect(listOrdersQuerySchema.safeParse({ sort: 'createdAt' }).success).toBe(true);
    expect(listOrdersQuerySchema.safeParse({ sort: 'total_amount; DROP TABLE orders' }).success).toBe(
      false,
    );
  });

  it('отклоняет перевёрнутый диапазон суммы', () => {
    const result = listOrdersQuerySchema.safeParse({ minAmount: '500', maxAmount: '100' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['minAmount']);
  });

  it('отклоняет перевёрнутый диапазон дат', () => {
    expect(
      listOrdersQuerySchema.safeParse({
        createdFrom: '2026-05-01T00:00:00.000Z',
        createdTo: '2026-04-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('запрещает одновременный фильтр по курьеру и «без курьера»', () => {
    expect(
      listOrdersQuerySchema.safeParse({ unassigned: 'true', courierId: COURIER_ID }).success,
    ).toBe(false);
  });

  it('отклоняет неизвестный параметр запроса', () => {
    expect(listOrdersQuerySchema.safeParse({ orderBy: 'createdAt' }).success).toBe(false);
  });
});
