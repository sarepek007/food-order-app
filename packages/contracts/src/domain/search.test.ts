import { describe, expect, it } from 'vitest';
import { MIN_SEARCH_QUERY_LENGTH, isSearchable, normalizeSearchQuery } from './search.js';

describe('normalizeSearchQuery', () => {
  it('приводит к нижнему регистру и обрезает края', () => {
    expect(normalizeSearchQuery('  Ленинский ПРОСПЕКТ  ')).toBe('ленинский проспект');
  });

  it('схлопывает повторяющиеся пробелы', () => {
    expect(normalizeSearchQuery('ул.    Мира,   12')).toBe('ул мира 12');
  });

  it('приравнивает ё к е — иначе триграммы расходятся', () => {
    expect(normalizeSearchQuery('Королёва')).toBe(normalizeSearchQuery('Королева'));
  });

  it('вычищает пунктуацию, но сохраняет цифры, дефис и слэш', () => {
    expect(normalizeSearchQuery('пр-т Мира, д. 12/3, кв. 45!')).toBe('пр-т мира д 12/3 кв 45');
  });

  it('не ломается на пустой строке', () => {
    expect(normalizeSearchQuery('   ')).toBe('');
  });

  it('идемпотентна', () => {
    const once = normalizeSearchQuery('  Ул.  Ленина,  д.5 ');
    expect(normalizeSearchQuery(once)).toBe(once);
  });

  it('сохраняет латиницу', () => {
    expect(normalizeSearchQuery('Tverskaya St. 7')).toBe('tverskaya st 7');
  });
});

describe('isSearchable', () => {
  it('отклоняет пустые и слишком короткие запросы', () => {
    expect(isSearchable(undefined)).toBe(false);
    expect(isSearchable(null)).toBe(false);
    expect(isSearchable('')).toBe(false);
    expect(isSearchable('  ')).toBe(false);
    expect(isSearchable('!')).toBe(false);
    expect(isSearchable('a')).toBe(false);
  });

  it('принимает запрос от минимальной длины', () => {
    expect(MIN_SEARCH_QUERY_LENGTH).toBe(2);
    expect(isSearchable('ми')).toBe(true);
    expect(isSearchable('Ленинский')).toBe(true);
  });
});
