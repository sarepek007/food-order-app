import { isProblemDetails, type ErrorCode, type ProblemDetails, type ValidationIssue } from '@food/contracts';

/**
 * Ошибка, пришедшая от API в формате problem+json.
 * Компоненты ветвятся по `code`, а не по тексту сообщения.
 */
export class ApiError extends Error {
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail || problem.title);
    this.name = 'ApiError';
    this.problem = problem;
  }

  get code(): ErrorCode {
    return this.problem.code;
  }

  get status(): number {
    return this.problem.status;
  }

  get details(): unknown {
    return this.problem.details;
  }

  /** Заказ изменил кто-то другой — интерфейс показывает разбор конфликта. */
  get isConflict(): boolean {
    return this.code === 'ORDER_VERSION_CONFLICT';
  }

  /** Ошибка схемы: раскладывается по полям формы. */
  get isValidation(): boolean {
    return this.code === 'VALIDATION_FAILED';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Ошибки валидации по путям до полей. */
  get fieldIssues(): ValidationIssue[] {
    const details = this.problem.details as { issues?: ValidationIssue[] } | undefined;
    return details?.issues ?? [];
  }
}

/** Сеть недоступна или сервер не ответил — принципиально иной случай, чем 4xx/5xx. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Нет связи с сервером. Проверьте подключение к сети.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/**
 * Сервис не отвечает: запрос дошёл до прокси, но приложение за ним недоступно.
 *
 * Прокси в таком случае отдаёт свой ответ, а не problem+json: Vite — пустой
 * `500 text/plain`, nginx — HTML-страницу `502`. Показывать оператору голый
 * код состояния бессмысленно: он не говорит ни что случилось, ни что делать.
 */
export class ServiceUnavailableError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(
      `Сервис временно недоступен (${status}). Изменения не сохранены. ` +
        'Повторите через несколько секунд — если не помогает, сообщите в поддержку.',
    );
    this.name = 'ServiceUnavailableError';
    this.status = status;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

export function isServiceUnavailable(error: unknown): error is ServiceUnavailableError {
  return error instanceof ServiceUnavailableError;
}

/**
 * Для оператора «сети нет» и «сервис лежит» — одна ситуация: работать нельзя,
 * надо повторить. Различаются только текстом, чтобы поддержке было понятнее.
 */
export function isUnavailable(error: unknown): boolean {
  return isNetworkError(error) || isServiceUnavailable(error);
}

/** Текст для пользователя из любой ошибки — единая точка, чтобы не плодить формулировки. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (isNetworkError(error) || isServiceUnavailable(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Произошла непредвиденная ошибка';
}

/**
 * Ответ, который не является problem+json. Такое приходит от прокси
 * и промежуточных узлов, а не от приложения.
 */
export function toProblem(payload: unknown, status: number): ProblemDetails {
  if (isProblemDetails(payload)) {
    return payload;
  }

  return {
    type: 'about:blank',
    title: 'Ошибка запроса',
    status,
    detail: `Запрос отклонён с кодом ${status}`,
    code: 'VALIDATION_FAILED',
  };
}
