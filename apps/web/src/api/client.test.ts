import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, server } from '@/test/server';
import { problem } from '@/test/fixtures';
import { apiRequest, buildQueryString, getActor, setActor } from './client';
import { ApiError, NetworkError, ServiceUnavailableError, errorMessage } from './errors';

/** Ожидаем отказ и возвращаем ошибку уже типизированной. */
async function rejection<T = ApiError>(promise: Promise<unknown>): Promise<T> {
  try {
    await promise;
  } catch (error) {
    return error as T;
  }
  throw new Error('ожидался отказ, но запрос завершился успешно');
}

describe('buildQueryString', () => {
  it('пропускает пустые значения', () => {
    expect(buildQueryString({ a: '', b: undefined, c: 'x' })).toBe('?c=x');
  });

  it('склеивает списки через запятую', () => {
    expect(buildQueryString({ status: ['new', 'ready'] })).toBe('?status=new%2Cready');
  });

  it('опускает пустые списки', () => {
    expect(buildQueryString({ status: [] })).toBe('');
  });

  it('на пустом объекте не добавляет вопросительный знак', () => {
    expect(buildQueryString({})).toBe('');
  });
});

describe('разбор ответа', () => {
  it('возвращает данные и ETag', async () => {
    server.use(
      http.get(`${API}/orders/:id`, () =>
        HttpResponse.json({ id: 'x', version: 7 }, { headers: { ETag: '"7"' } }),
      ),
    );

    const response = await apiRequest<{ id: string }>('/orders/x');
    expect(response.data).toEqual({ id: 'x', version: 7 });
    expect(response.etag).toBe('"7"');
  });

  it('превращает problem+json в ApiError с кодом', async () => {
    server.use(
      http.get(`${API}/orders/:id`, () =>
        HttpResponse.json(problem('ORDER_NOT_FOUND', 404, 'Заказ не найден'), { status: 404 }),
      ),
    );

    await expect(apiRequest('/orders/x')).rejects.toBeInstanceOf(ApiError);

    const error = await rejection(apiRequest('/orders/x'));
    expect(error.code).toBe('ORDER_NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.isNotFound).toBe(true);
    expect(error.message).toBe('Заказ не найден');
  });

  it('раскладывает ошибки валидации по полям', async () => {
    server.use(
      http.post(`${API}/orders`, () =>
        HttpResponse.json(
          problem('VALIDATION_FAILED', 400, 'Запрос не прошёл валидацию', {
            issues: [{ path: 'customerName', message: 'Укажите имя клиента' }],
          }),
          { status: 400 },
        ),
      ),
    );

    const error = await rejection(apiRequest('/orders', { method: 'POST', body: {} }));

    expect(error.isValidation).toBe(true);
    expect(error.fieldIssues).toEqual([{ path: 'customerName', message: 'Укажите имя клиента' }]);
  });

  it('распознаёт конфликт версий', async () => {
    server.use(
      http.patch(`${API}/orders/:id/status`, () =>
        HttpResponse.json(problem('ORDER_VERSION_CONFLICT', 409, 'Заказ изменён'), { status: 409 }),
      ),
    );

    const error = await rejection(apiRequest('/orders/x/status', { method: 'PATCH', body: {} }));
    expect(error.isConflict).toBe(true);
  });

  it('ответ без тела не ломает разбор', async () => {
    server.use(http.get(`${API}/orders`, () => new HttpResponse(null, { status: 204 })));
    await expect(apiRequest('/orders')).resolves.toMatchObject({ data: null });
  });

  it.each([
    ['nginx отдаёт HTML', 502, '<html>502 Bad Gateway</html>'],
    ['прокси Vite отдаёт пустое тело', 500, ''],
    ['балансировщик отдаёт 503', 503, 'Service Unavailable'],
  ])('%s — это недоступность сервиса, а не ошибка запроса', async (_label, status, body) => {
    server.use(http.get(`${API}/orders`, () => new HttpResponse(body, { status })));

    const error = await rejection<unknown>(apiRequest('/orders'));

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    // Оператору нужен не код состояния, а что случилось и что делать.
    expect(errorMessage(error)).toContain('Сервис временно недоступен');
    expect(errorMessage(error)).toContain('Изменения не сохранены');
    expect(errorMessage(error)).toContain(String(status));
  });

  it('5xx с problem+json остаётся ошибкой приложения', async () => {
    server.use(
      http.get(`${API}/orders`, () =>
        HttpResponse.json(problem('INTERNAL_ERROR', 500, 'Не удалось обработать запрос'), {
          status: 500,
        }),
      ),
    );

    const error = await rejection(apiRequest('/orders'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toBe('Не удалось обработать запрос');
  });

  it('4xx без problem+json остаётся ошибкой запроса', async () => {
    server.use(http.get(`${API}/orders`, () => new HttpResponse('nope', { status: 404 })));

    const error = await rejection(apiRequest('/orders'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
  });

  it('обрыв связи отличается от ответа сервера', async () => {
    server.use(http.get(`${API}/orders`, () => HttpResponse.error()));

    const error = await rejection<unknown>(apiRequest('/orders'));
    expect(error).toBeInstanceOf(NetworkError);
    expect(errorMessage(error)).toContain('Проверьте подключение');
  });
});

describe('заголовки запроса', () => {
  it('передаёт If-Match и кодирует имя оператора', async () => {
    setActor('Анна Петрова');

    let ifMatch: string | null = null;
    let actor: string | null = null;
    server.use(
      http.patch(`${API}/orders/:id/status`, ({ request }) => {
        ifMatch = request.headers.get('If-Match');
        actor = request.headers.get('X-Actor');
        return HttpResponse.json({ ok: true });
      }),
    );

    await apiRequest('/orders/x/status', { method: 'PATCH', body: {}, ifMatch: '"7"' });

    expect(ifMatch).toBe('"7"');
    expect(decodeURIComponent(actor!)).toBe('Анна Петрова');
  });

  it('имя оператора сохраняется между сессиями', () => {
    setActor('Борис Кириллов');
    expect(getActor()).toBe('Борис Кириллов');

    setActor('   ');
    expect(getActor()).toBe('Оператор');
  });
});
