import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTOR, decodeHeaderValue, normalizeActor } from '../../src/plugins/actor-context.js';

/** То, что видит Node, когда клиент шлёт UTF-8 в заголовке. */
function asRawHeader(value: string): string {
  return Buffer.from(value, 'utf8').toString('latin1');
}

describe('декодирование значения заголовка', () => {
  it('оставляет ASCII без изменений', () => {
    expect(decodeHeaderValue('operator')).toBe('operator');
    expect(decodeHeaderValue('Anna Smith')).toBe('Anna Smith');
  });

  it('восстанавливает кириллицу из сырых UTF-8 байтов', () => {
    expect(decodeHeaderValue(asRawHeader('Анна'))).toBe('Анна');
    expect(decodeHeaderValue(asRawHeader('Мария Операторова'))).toBe('Мария Операторова');
  });

  it('понимает процентное кодирование', () => {
    expect(decodeHeaderValue(encodeURIComponent('Анна Петрова'))).toBe('Анна Петрова');
  });

  it('не падает на некорректной процентной последовательности', () => {
    expect(decodeHeaderValue('100%25 %ZZ')).toBe('100%25 %ZZ');
  });

  it('сохраняет эмодзи и другие многобайтовые символы', () => {
    expect(decodeHeaderValue(asRawHeader('оператор 🚀'))).toBe('оператор 🚀');
  });
});

describe('нормализация автора', () => {
  it('подставляет значение по умолчанию, когда заголовка нет', () => {
    expect(normalizeActor(undefined)).toBe(DEFAULT_ACTOR);
    expect(normalizeActor('')).toBe(DEFAULT_ACTOR);
    expect(normalizeActor('   ')).toBe(DEFAULT_ACTOR);
  });

  it('берёт первое значение при повторе заголовка', () => {
    expect(normalizeActor(['Анна', 'Борис'])).toBe('Анна');
  });

  it('обрезает слишком длинное имя', () => {
    expect(normalizeActor('и'.repeat(200))).toHaveLength(80);
  });

  it('обрезает пробелы по краям', () => {
    expect(normalizeActor('  Анна  ')).toBe('Анна');
  });
});
