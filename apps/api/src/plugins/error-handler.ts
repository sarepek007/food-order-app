import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { isDomainError } from '../errors/domain-error.js';
import { PROBLEM_CONTENT_TYPE, buildProblem, problemFromError } from '../http/problem.js';

/**
 * Единый обработчик ошибок. Роуты не занимаются маппингом статусов:
 * они бросают DomainError, всё остальное приводится здесь.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const context = { instance: request.url, requestId: request.id };

    // Ошибки схемы запроса: раскладываем по путям до полей.
    if (hasZodFastifySchemaValidationErrors(error)) {
      const problem = buildProblem('VALIDATION_FAILED', 'Запрос не прошёл валидацию', {
        ...context,
        details: {
          issues: error.validation.map((item) => ({
            path: item.params.issue.path.join('.'),
            message: item.params.issue.message,
          })),
        },
      });
      request.log.info({ issues: problem.details }, 'запрос отклонён валидацией');
      return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
    }

    // Ответ не сошёлся со схемой — это дефект сервера, наружу деталей не отдаём.
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error, method: error.method, url: error.url }, 'ответ не соответствует схеме');
      const problem = buildProblem('INTERNAL_ERROR', 'Не удалось сформировать ответ', context);
      return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
    }

    if (isDomainError(error)) {
      const problem = problemFromError(error, context);
      // Нарушение бизнес-правила — штатный исход, а не сбой: пишем на info.
      request.log.info(
        { code: error.code, status: problem.status, details: error.details },
        'операция отклонена',
      );
      return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
    }

    // Некорректный JSON и прочие ошибки самого HTTP-слоя.
    const httpError = error as Error & { statusCode?: number };
    const statusCode = httpError.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const problem = buildProblem('VALIDATION_FAILED', httpError.message, context);
      return reply.status(statusCode).type(PROBLEM_CONTENT_TYPE).send({ ...problem, status: statusCode });
    }

    request.log.error({ err: error }, 'необработанная ошибка');
    const problem = problemFromError(error, context);
    return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
  });

  app.setNotFoundHandler((request, reply) => {
    const problem = buildProblem('VALIDATION_FAILED', `Маршрут ${request.method} ${request.url} не найден`, {
      instance: request.url,
      requestId: request.id,
    });
    return reply.status(404).type(PROBLEM_CONTENT_TYPE).send({ ...problem, status: 404, title: 'Маршрут не найден' });
  });
}
