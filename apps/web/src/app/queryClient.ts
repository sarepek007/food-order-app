import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

/**
 * Фабрика, а не синглтон: каждый тест получает чистый кэш,
 * иначе результаты просачиваются между проверками.
 */
export interface QueryClientOptions {
  /** Тесты отключают повторы: они только добавляют ожидание к проверке. */
  retry?: boolean;
}

export function createQueryClient({ retry = true }: QueryClientOptions = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Повторять запрос при 4xx бессмысленно: ответ не изменится.
        retry: retry
          ? (failureCount, error) =>
              !(error instanceof ApiError && error.status < 500) && failureCount < 2
          : false,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
