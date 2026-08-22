import { useCallback, useEffect, useRef } from 'react';

/**
 * Ограничитель частоты вызовов с завершающим срабатыванием.
 *
 * Поток изменений может принести пачку событий подряд (оператор проводит
 * заказ по нескольким статусам). Перезапрашивать список на каждое —
 * значит устроить шторм запросов; достаточно одного обновления на интервал,
 * но последнее событие пропустить нельзя — отсюда завершающий вызов.
 */
export function useThrottled(callback: () => void, intervalMs: number): () => void {
  const callbackRef = useRef(callback);
  const lastRunRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastRunRef.current;

    if (elapsed >= intervalMs) {
      lastRunRef.current = now;
      callbackRef.current();
      return;
    }

    if (timerRef.current) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      lastRunRef.current = Date.now();
      callbackRef.current();
    }, intervalMs - elapsed);
  }, [intervalMs]);
}
