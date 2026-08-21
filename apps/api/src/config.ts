import process from 'node:process';
import { z } from 'zod';
import {
  DEFAULT_COURIER_ACTIVE_LIMIT,
  DEFAULT_STATUS_SLA_SECONDS,
  ORDER_STATUSES,
  type StatusSlaMap,
} from '@food/contracts';

/**
 * Нормативы времени на статус зависят от города, кухни и времени суток,
 * поэтому значения из @food/contracts — только основа. Переопределение
 * приходит одним JSON: STATUS_SLA_SECONDS={"preparing":1800,"ready":600}.
 */
const slaOverridesSchema = z
  .record(z.enum(ORDER_STATUSES), z.number().int().positive().nullable())
  .optional();

/**
 * Конфигурация валидируется один раз при старте: некорректный env должен
 * ронять процесс сразу, а не на первом запросе к БД.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  COURIER_ACTIVE_LIMIT: z.coerce.number().int().positive().default(DEFAULT_COURIER_ACTIVE_LIMIT),
  STATUS_SLA_SECONDS: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined;
      try {
        return slaOverridesSchema.parse(JSON.parse(raw));
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Ожидается JSON вида {"preparing":1800}',
        });
        return z.NEVER;
      }
    }),
  SEARCH_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>> & {
  /** Итоговые нормативы: значения по умолчанию, перекрытые переменной окружения. */
  readonly statusSla: StatusSlaMap;
};

/** Подхватывает .env рядом с пакетом, если он есть. Продакшен передаёт env напрямую. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // .env отсутствует — это нормальный сценарий для контейнера и CI.
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Некорректная конфигурация окружения:\n${problems}`);
  }

  const statusSla: StatusSlaMap = Object.freeze({
    ...DEFAULT_STATUS_SLA_SECONDS,
    ...(parsed.data.STATUS_SLA_SECONDS ?? {}),
  });

  return Object.freeze({ ...parsed.data, statusSla });
}

let cached: AppConfig | undefined;

/** Ленивый синглтон: тесты могут собрать собственный конфиг через loadConfig(). */
export function getConfig(): AppConfig {
  if (!cached) {
    loadDotEnv();
    cached = loadConfig();
  }
  return cached;
}
