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
    super('Не удалось связаться с сервером. Проверьте подключение.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

/** Текст для пользователя из любой ошибки — единая точка, чтобы не плодить формулировки. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (isNetworkError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Произошла непредвиденная ошибка';
}

export function toProblem(payload: unknown, status: number): ProblemDetails {
  if (isProblemDetails(payload)) {
    return payload;
  }

  return {
    type: 'about:blank',
    title: 'Ошибка запроса',
    status,
    detail: `Сервер вернул ${status} без пояснения`,
    code: status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED',
  };
}
