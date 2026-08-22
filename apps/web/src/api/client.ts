import { isProblemDetails } from '@food/contracts';
import { ApiError, NetworkError, ServiceUnavailableError, toProblem } from './errors.js';

const BASE_URL = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1';

/** Имя оператора. Аутентификации нет — журнал наполняется этим значением. */
const ACTOR_STORAGE_KEY = 'food-order-app.actor';
export const DEFAULT_ACTOR = 'Оператор';

/**
 * Постоянное хранилище недоступно в двух реальных случаях: приватный режим
 * браузера (обращение бросает исключение) и тестовое окружение без localStorage.
 * Ни один из них не повод ронять приложение из-за имени оператора,
 * поэтому есть запасное хранилище в памяти.
 */
const memoryStorage = new Map<string, string>();

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): MinimalStorage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Приватный режим: доступ запрещён политикой браузера.
  }

  return {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value);
    },
  };
}

export function getActor(): string {
  return storage().getItem(ACTOR_STORAGE_KEY) ?? DEFAULT_ACTOR;
}

export function setActor(actor: string): void {
  storage().setItem(ACTOR_STORAGE_KEY, actor.trim() || DEFAULT_ACTOR);
}

export interface ApiResponse<T> {
  data: T;
  /** Версия ресурса из ETag. Хранится рядом с данными и уходит обратно в If-Match. */
  etag: string | null;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Значение ETag для If-Match; '*' означает «применить поверх». */
  ifMatch?: string | null;
  /** Ключ повтора: защищает от двойного применения при ретрае и двойном клике. */
  idempotencyKey?: string | undefined;
  signal?: AbortSignal;
  query?: Record<string, string | string[] | number | boolean | undefined>;
}

export function buildQueryString(
  query: Record<string, string | string[] | number | boolean | undefined>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }

  const search = params.toString();
  return search ? `?${search}` : '';
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = 'GET', body, ifMatch, idempotencyKey, signal, query } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json, application/problem+json',
    // Кириллица в заголовке передаётся процентным кодированием: значения
    // заголовков — байты latin-1, сырой UTF-8 приезжает мусором.
    'X-Actor': encodeURIComponent(getActor()),
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (ifMatch) {
    headers['If-Match'] = ifMatch;
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const url = `${BASE_URL}${path}${query ? buildQueryString(query) : ''}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new NetworkError(error);
  }

  const payload = await parseBody(response);

  if (!response.ok) {
    // Ответ 5xx без problem+json приходит не от приложения, а от прокси
    // перед ним: значит, сервис не отвечает, и это не ошибка запроса.
    if (response.status >= 500 && !isProblemDetails(payload)) {
      throw new ServiceUnavailableError(response.status);
    }
    throw new ApiError(toProblem(payload, response.status));
  }

  return { data: payload as T, etag: response.headers.get('ETag') };
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // Не-JSON ответ (например, страница ошибки прокси) — отдаём как есть,
    // toProblem() превратит его в понятный problem+json.
    return text;
  }
}
