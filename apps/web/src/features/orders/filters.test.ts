import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filtersFromSearchParams,
  filtersToQuery,
  filtersToSearchParams,
  hasActiveFilters,
  resetFilters,
  withFilterChange,
  type OrderFilters,
} from './filters';

function parse(search: string): OrderFilters {
  return filtersFromSearchParams(new URLSearchParams(search));
}

describe('чтение фильтров из адреса', () => {
  it('пустой адрес даёт значения по умолчанию', () => {
    expect(parse('')).toEqual(DEFAULT_FILTERS);
  });

  it('разбирает список статусов', () => {
    expect(parse('status=new,ready').status).toEqual(['new', 'ready']);
  });

  it('отбрасывает несуществующие статусы вместо падения', () => {
    expect(parse('status=new,shipped,ready').status).toEqual(['new', 'ready']);
  });

  it('разбирает флаг «только просроченные»', () => {
    expect(parse('overdue=true').overdue).toBe(true);
    expect(parse('').overdue).toBe(false);
  });

  it('разбирает флаг «без курьера»', () => {
    expect(parse('unassigned=true').unassigned).toBe(true);
    expect(parse('unassigned=false').unassigned).toBe(false);
  });

  it('игнорирует сортировку вне белого списка', () => {
    expect(parse('sort=drop_table').sort).toBe('createdAt');
    expect(parse('sort=totalAmount').sort).toBe('totalAmount');
  });

  it.each([
    ['нечисловая сумма', 'minAmount=zzz', 'minAmount'],
    ['отрицательная сумма', 'minAmount=-10', 'minAmount'],
    ['мусор вместо даты', 'createdFrom=вчера', 'createdFrom'],
    ['несуществующая дата', 'createdTo=2026-02-31', 'createdTo'],
    ['дата в чужом формате', 'createdFrom=01.05.2026', 'createdFrom'],
  ])('отбрасывает %s: иначе список навсегда упрётся в ошибку', (_label, search, field) => {
    expect(parse(search)[field as 'minAmount']).toBe('');
  });

  it('корректные сумму и дату сохраняет', () => {
    expect(parse('minAmount=100.5').minAmount).toBe('100.5');
    expect(parse('createdFrom=2026-05-01').createdFrom).toBe('2026-05-01');
  });

  it('защищается от некорректной страницы', () => {
    expect(parse('page=0').page).toBe(1);
    expect(parse('page=-3').page).toBe(1);
    expect(parse('page=abc').page).toBe(1);
    expect(parse('page=4').page).toBe(4);
  });
});

describe('запись фильтров в адрес', () => {
  it('не пишет значения по умолчанию — адрес остаётся коротким', () => {
    expect(filtersToSearchParams(DEFAULT_FILTERS).toString()).toBe('');
  });

  it('сохраняет только заданные фильтры', () => {
    const params = filtersToSearchParams({
      ...DEFAULT_FILTERS,
      status: ['new', 'ready'],
      q: '  Ленина  ',
      page: 3,
    });

    expect(params.get('status')).toBe('new,ready');
    expect(params.get('q')).toBe('Ленина');
    expect(params.get('page')).toBe('3');
    expect(params.get('order')).toBeNull();
  });

  it('чтение и запись — обратимые операции', () => {
    const filters: OrderFilters = {
      ...DEFAULT_FILTERS,
      status: ['accepted'],
      restaurantId: ['r-1'],
      unassigned: true,
      q: 'Мира',
      minAmount: '100',
      maxAmount: '5000',
      createdFrom: '2026-05-01',
      createdTo: '2026-05-20',
      sort: 'totalAmount',
      order: 'asc',
      page: 2,
      pageSize: 50,
    };

    expect(filtersFromSearchParams(filtersToSearchParams(filters))).toEqual(filters);
  });
});

describe('преобразование в запрос к API', () => {
  it('передаёт только заполненные параметры', () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toEqual({
      sort: 'createdAt',
      order: 'desc',
      page: 1,
      pageSize: 25,
    });
  });

  it('приводит суммы к числам, а даты передаёт как есть', () => {
    const query = filtersToQuery({
      ...DEFAULT_FILTERS,
      minAmount: '100.5',
      createdFrom: '2026-05-01',
      createdTo: '2026-05-20',
    });

    expect(query.minAmount).toBe(100.5);
    // Раскрытие даты в целые сутки — задача сервера: одно правило на обе
    // стороны вместо двух, расходящихся на часовой пояс.
    expect(query.createdFrom).toBe('2026-05-01');
    expect(query.createdTo).toBe('2026-05-20');
  });

  it('обрезает пробелы в поисковом запросе', () => {
    expect(filtersToQuery({ ...DEFAULT_FILTERS, q: '  Ленина  ' }).q).toBe('Ленина');
    expect(filtersToQuery({ ...DEFAULT_FILTERS, q: '   ' }).q).toBeUndefined();
  });
});

describe('изменение фильтров', () => {
  it('любое изменение фильтра возвращает на первую страницу', () => {
    const current: OrderFilters = { ...DEFAULT_FILTERS, page: 5 };
    expect(withFilterChange(current, { q: 'Мира' }).page).toBe(1);
  });

  it('явная смена страницы её сохраняет', () => {
    const current: OrderFilters = { ...DEFAULT_FILTERS, page: 5 };
    expect(withFilterChange(current, { page: 6 }).page).toBe(6);
  });

  it('сброс сохраняет сортировку и размер страницы', () => {
    const current: OrderFilters = {
      ...DEFAULT_FILTERS,
      q: 'Мира',
      status: ['new'],
      sort: 'totalAmount',
      order: 'asc',
      pageSize: 50,
    };

    expect(resetFilters(current)).toMatchObject({
      q: '',
      status: [],
      sort: 'totalAmount',
      order: 'asc',
      pageSize: 50,
    });
  });
});

describe('признак активных фильтров', () => {
  it('сортировка и страница не считаются фильтром', () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, sort: 'totalAmount', page: 3 })).toBe(false);
  });

  it.each([
    ['статус', { status: ['new'] as OrderFilters['status'] }],
    ['поиск', { q: 'Мира' }],
    ['без курьера', { unassigned: true }],
    ['только просроченные', { overdue: true }],
    ['сумма', { minAmount: '100' }],
    ['дата', { createdFrom: '2026-05-01' }],
  ])('%s считается активным фильтром', (_label, patch) => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, ...patch })).toBe(true);
  });
});
