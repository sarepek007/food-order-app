import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { createQueryClient } from './queryClient';

function retryPolicy(client: ReturnType<typeof createQueryClient>) {
  const retry = client.getDefaultOptions().queries?.retry;
  if (typeof retry !== 'function') {
    throw new Error('ожидалась функция политики повторов');
  }
  return retry;
}

function problem(status: number): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'Ошибка',
    status,
    detail: 'детали',
    code: status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED',
  });
}

describe('политика повторов', () => {
  it('не повторяет запрос при ошибке клиента — ответ не изменится', () => {
    const retry = retryPolicy(createQueryClient());

    expect(retry(0, problem(400))).toBe(false);
    expect(retry(0, problem(404))).toBe(false);
    expect(retry(0, problem(409))).toBe(false);
  });

  it('повторяет при ошибке сервера и обрыве связи', () => {
    const retry = retryPolicy(createQueryClient());

    expect(retry(0, problem(500))).toBe(true);
    expect(retry(0, new Error('сеть недоступна'))).toBe(true);
  });

  it('ограничивает число повторов', () => {
    const retry = retryPolicy(createQueryClient());

    expect(retry(1, problem(500))).toBe(true);
    expect(retry(2, problem(500))).toBe(false);
  });

  it('в тестовом режиме повторов нет вовсе', () => {
    const client = createQueryClient({ retry: false });
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
  });

  it('мутации не повторяются никогда: они не идемпотентны сами по себе', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });
});
