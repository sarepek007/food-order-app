import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThrottled } from './useThrottled';

describe('useThrottled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('первый вызов проходит сразу', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useThrottled(callback, 1000));

    act(() => result.current());
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('пачка вызовов схлопывается в два: немедленный и завершающий', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useThrottled(callback, 1000));

    act(() => {
      result.current();
      result.current();
      result.current();
      result.current();
    });
    expect(callback).toHaveBeenCalledTimes(1);

    // Последнее событие пачки не теряется.
    act(() => void vi.advanceTimersByTime(1000));
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('после паузы вызов снова проходит немедленно', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useThrottled(callback, 1000));

    act(() => result.current());
    act(() => void vi.advanceTimersByTime(1500));
    act(() => result.current());

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('снимает отложенный вызов при размонтировании', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useThrottled(callback, 1000));

    act(() => {
      result.current();
      result.current();
    });
    unmount();
    act(() => void vi.advanceTimersByTime(2000));

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
