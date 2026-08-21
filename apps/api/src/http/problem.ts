import { ERROR_CODE_STATUS, problemTypeFor, type ErrorCode, type ProblemDetails } from '@food/contracts';
import { ZodError, type ZodIssue } from 'zod';
import { DomainError, isDomainError } from '../errors/domain-error.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

const TITLES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Некорректные данные запроса',
  ORDER_NOT_FOUND: 'Заказ не найден',
  RESTAURANT_NOT_FOUND: 'Ресторан не найден',
  COURIER_NOT_FOUND: 'Курьер не найден',
  ORDER_INVALID_TRANSITION: 'Недопустимый переход статуса',
  ORDER_NOT_CANCELLABLE: 'Заказ нельзя отменить',
  ORDER_TERMINAL: 'Заказ уже завершён',
  ORDER_VERSION_CONFLICT: 'Заказ был изменён другим пользователем',
  COURIER_CAPACITY_EXCEEDED: 'Превышен лимит активных доставок',
  ORDER_COURIER_REQUIRED: 'Требуется курьер',
  COURIER_INACTIVE: 'Курьер неактивен',
  ORDER_COURIER_NOT_ASSIGNED: 'Курьер не назначен',
  RESTAURANT_INACTIVE: 'Ресторан неактивен',
  PRECONDITION_REQUIRED: 'Не передана версия заказа',
  INTERNAL_ERROR: 'Внутренняя ошибка сервера',
};

function titleFor(code: ErrorCode): string {
  return TITLES[code] ?? 'Ошибка';
}

export function buildProblem(
  code: ErrorCode,
  detail: string,
  options: { details?: unknown; instance?: string; requestId?: string } = {},
): ProblemDetails {
  const problem: ProblemDetails = {
    type: problemTypeFor(code),
    title: titleFor(code),
    status: ERROR_CODE_STATUS[code],
    detail,
    code,
  };

  if (options.instance !== undefined) problem.instance = options.instance;
  if (options.requestId !== undefined) problem.requestId = options.requestId;
  if (options.details !== undefined) problem.details = options.details;

  return problem;
}

/** Раскладывает ошибки схемы по путям до полей — форма на клиенте подсветит нужный инпут. */
export function issuesFromZod(error: ZodError): { issues: { path: string; message: string }[] } {
  return {
    issues: error.issues.map((issue: ZodIssue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

export interface ProblemContext {
  instance?: string;
  requestId?: string;
}

/**
 * Единственная точка перевода исключений в HTTP-ответ.
 * Доменные ошибки несут код и статус в себе, всё остальное — 500 без деталей наружу.
 */
export function problemFromError(error: unknown, context: ProblemContext = {}): ProblemDetails {
  if (isDomainError(error)) {
    return buildProblem(error.code, error.message, { ...context, details: error.details });
  }

  if (error instanceof ZodError) {
    return buildProblem('VALIDATION_FAILED', 'Запрос не прошёл валидацию', {
      ...context,
      details: issuesFromZod(error),
    });
  }

  return buildProblem('INTERNAL_ERROR', 'Не удалось обработать запрос', context);
}

export { DomainError };
