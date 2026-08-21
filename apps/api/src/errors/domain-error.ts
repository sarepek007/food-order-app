import { ERROR_CODE_STATUS, problemTypeFor, type ErrorCode, type RuleViolation } from '@food/contracts';

/**
 * Единственный тип ошибки, который сервисный слой бросает наружу.
 * HTTP-статус выводится из кода, поэтому роуты не занимаются маппингом.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = ERROR_CODE_STATUS[code];
    this.details = details;
  }

  /** Ошибка из нарушения доменного правила: текст и детали уже подготовлены в @food/contracts. */
  static fromViolation(violation: RuleViolation): DomainError {
    return new DomainError(violation.code, violation.message, violation.details);
  }

  static notFound(code: ErrorCode, message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError(code, message, details);
  }

  get problemType(): string {
    return problemTypeFor(this.code);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Бросает DomainError, если правило нарушено. Сжимает `if (!result.ok) throw ...` до одной строки. */
export function assertRule(result: { ok: true } | { ok: false; violation: RuleViolation }): void {
  if (!result.ok) {
    throw DomainError.fromViolation(result.violation);
  }
}
