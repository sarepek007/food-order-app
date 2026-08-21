/**
 * Нормализация поискового запроса по адресу.
 *
 * Приводится к нижнему регистру, схлопываются пробелы и пунктуация,
 * «ё» приравнивается к «е» — иначе триграммное сходство падает на ровном месте
 * («Королёва» и «Королева» дают разные наборы триграмм).
 */
export function normalizeSearchQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}\s/-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Минимальная длина запроса, при которой имеет смысл нечёткий поиск. */
export const MIN_SEARCH_QUERY_LENGTH = 2;

export function isSearchable(raw: string | undefined | null): boolean {
  if (!raw) return false;
  return normalizeSearchQuery(raw).length >= MIN_SEARCH_QUERY_LENGTH;
}
