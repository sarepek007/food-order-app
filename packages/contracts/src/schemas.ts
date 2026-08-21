import { z } from 'zod';
import { AUDIT_ACTIONS } from './audit.js';
import { ORDER_STATUSES } from './order-status.js';

/* ------------------------------------------------------------------ */
/* Примитивы                                                           */
/* ------------------------------------------------------------------ */

export const uuidSchema = z.string().uuid('Ожидается UUID');

/**
 * Денежная сумма передаётся строкой: numeric(12,2) в Postgres не помещается
 * в double без потерь, а округление денег на клиенте недопустимо.
 */
export const moneySchema = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Сумма должна быть числом с не более чем двумя знаками после запятой');

export const orderStatusSchema = z.enum(ORDER_STATUSES);

/** Статусы, доступные через PATCH /status. Отмена вынесена в отдельный эндпоинт. */
export const transitionStatusSchema = z.enum([
  'accepted',
  'preparing',
  'ready',
  'picked_up',
  'delivered',
]);

export const auditActionSchema = z.enum(AUDIT_ACTIONS);

/** Принимает и `?status=a&status=b`, и `?status=a,b`. */
function csvArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value) ? value : [value];
    return raw
      .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : [entry]))
      .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
      .filter((entry) => entry !== '');
  }, z.array(item).optional());
}

const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}, z.boolean().optional());

/* ------------------------------------------------------------------ */
/* Запросы                                                             */
/* ------------------------------------------------------------------ */

export const createOrderSchema = z
  .object({
    customerName: z.string().trim().min(2, 'Укажите имя клиента').max(120),
    customerPhone: z
      .string()
      .trim()
      .regex(/^\+?[\d\s()-]{7,20}$/, 'Некорректный номер телефона')
      .optional(),
    restaurantId: uuidSchema,
    courierId: uuidSchema.optional(),
    deliveryAddress: z.string().trim().min(5, 'Укажите адрес доставки').max(500),
    totalAmount: moneySchema,
    currency: z.string().length(3).toUpperCase().default('RUB'),
  })
  .strict();

export const changeStatusSchema = z
  .object({
    status: transitionStatusSchema,
    comment: z.string().trim().max(500).optional(),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const assignCourierSchema = z
  .object({
    courierId: uuidSchema,
    version: z.number().int().positive().optional(),
  })
  .strict();

export const unassignCourierSchema = z
  .object({
    version: z.number().int().positive().optional(),
  })
  .strict();

export const cancelOrderSchema = z
  .object({
    reason: z.string().trim().min(3, 'Укажите причину отмены').max(500),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const ORDER_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'totalAmount',
  'status',
  'relevance',
] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const listOrdersQuerySchema = z
  .object({
    status: csvArray(orderStatusSchema),
    restaurantId: csvArray(uuidSchema),
    courierId: csvArray(uuidSchema),
    unassigned: booleanQuerySchema,
    q: z.string().trim().max(200).optional(),
    minAmount: z.coerce.number().nonnegative().optional(),
    maxAmount: z.coerce.number().nonnegative().optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
    sort: z.enum(ORDER_SORT_FIELDS).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.minAmount !== undefined && value.maxAmount !== undefined && value.minAmount > value.maxAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minAmount'],
        message: 'minAmount не может превышать maxAmount',
      });
    }
    if (value.createdFrom && value.createdTo && value.createdFrom > value.createdTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['createdFrom'],
        message: 'createdFrom не может быть позже createdTo',
      });
    }
    if (value.unassigned === true && value.courierId && value.courierId.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unassigned'],
        message: 'Нельзя одновременно фильтровать по курьеру и по «без курьера»',
      });
    }
  });

export const auditQuerySchema = z
  .object({
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(50),
  })
  .strict();

export const orderIdParamsSchema = z.object({ id: uuidSchema }).strict();

/* ------------------------------------------------------------------ */
/* Ответы                                                              */
/* ------------------------------------------------------------------ */

export const restaurantRefSchema = z.object({
  id: uuidSchema,
  name: z.string(),
});

export const courierRefSchema = z.object({
  id: uuidSchema,
  name: z.string(),
});

export const orderListItemSchema = z.object({
  id: uuidSchema,
  publicNumber: z.number().int(),
  status: orderStatusSchema,
  customerName: z.string(),
  restaurant: restaurantRefSchema,
  courier: courierRefSchema.nullable(),
  deliveryAddress: z.string(),
  totalAmount: moneySchema,
  currency: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  version: z.number().int().positive(),
});

export const orderDetailsSchema = orderListItemSchema.extend({
  customerPhone: z.string().nullable(),
  cancelReason: z.string().nullable(),
  restaurant: restaurantRefSchema.extend({ address: z.string() }),
  allowedTransitions: z.array(orderStatusSchema),
  cancellable: z.boolean(),
});

export const auditEntrySchema = z.object({
  id: z.string(),
  orderId: uuidSchema,
  action: auditActionSchema,
  oldStatus: orderStatusSchema.nullable(),
  newStatus: orderStatusSchema.nullable(),
  oldCourier: courierRefSchema.nullable(),
  newCourier: courierRefSchema.nullable(),
  comment: z.string().nullable(),
  actor: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});

export const restaurantSchema = restaurantRefSchema.extend({
  address: z.string(),
  isActive: z.boolean(),
});

export const courierSchema = courierRefSchema.extend({
  phone: z.string().nullable(),
  isActive: z.boolean(),
  activeOrdersCount: z.number().int().nonnegative(),
  activeLimit: z.number().int().positive(),
  hasCapacity: z.boolean(),
});

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  });
}

export const orderListResponseSchema = paginatedSchema(orderListItemSchema);
export const auditListResponseSchema = paginatedSchema(auditEntrySchema);

/* ------------------------------------------------------------------ */
/* Выводимые типы                                                      */
/* ------------------------------------------------------------------ */

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type AssignCourierInput = z.infer<typeof assignCourierSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
export type ListOrdersQueryInput = z.input<typeof listOrdersQuerySchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export type RestaurantRef = z.infer<typeof restaurantRefSchema>;
export type CourierRef = z.infer<typeof courierRefSchema>;
export type OrderListItem = z.infer<typeof orderListItemSchema>;
export type OrderDetails = z.infer<typeof orderDetailsSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type Restaurant = z.infer<typeof restaurantSchema>;
export type Courier = z.infer<typeof courierSchema>;
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
