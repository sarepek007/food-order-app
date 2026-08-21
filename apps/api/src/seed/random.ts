/**
 * Детерминированный генератор псевдослучайных чисел (mulberry32).
 *
 * Math.random() непригоден: демонстрация и тесты должны воспроизводиться
 * побайтово, иначе «у меня не воспроизводится» становится нормой.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Число в [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** Целое в [min, max] включительно. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('pick() вызван на пустом списке');
    }
    return items[this.int(0, items.length - 1)]!;
  }

  /** Выбор с весами: [[значение, вес], ...]. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let threshold = this.next() * total;

    for (const [value, weight] of entries) {
      threshold -= weight;
      if (threshold <= 0) {
        return value;
      }
    }

    return entries[entries.length - 1]![0];
  }

  /** Перемешивание копии (Фишер — Йетс). */
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapWith = this.int(0, index);
      [result[index], result[swapWith]] = [result[swapWith]!, result[index]!];
    }
    return result;
  }

  /**
   * UUID v4 из того же потока случайности: идентификаторы тоже должны быть
   * воспроизводимыми, иначе ссылки в документации протухают после пересева.
   */
  uuid(): string {
    const bytes = Array.from({ length: 16 }, () => this.int(0, 255));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  }

  /** Денежная сумма строкой с двумя знаками — формат API (ADR 0002). */
  money(min: number, max: number): string {
    const value = this.int(min * 100, max * 100) / 100;
    return value.toFixed(2);
  }
}
