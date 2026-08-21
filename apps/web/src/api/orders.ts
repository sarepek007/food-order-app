import type {
  AuditListResponse,
  Courier,
  OrderDetails,
  OrderListResponse,
  Restaurant,
} from '@food/contracts';
import { apiRequest, type ApiResponse } from './client.js';

export interface OrderListParams {
  status?: string[];
  restaurantId?: string[];
  courierId?: string[];
  unassigned?: boolean;
  overdue?: boolean;
  q?: string;
  minAmount?: number;
  maxAmount?: number;
  createdFrom?: string;
  createdTo?: string;
  sort?: string;
  order?: string;
  page?: number;
  pageSize?: number;
}

/** ETag ресурса. Заголовок предпочтительнее, версия из тела — запасной путь. */
export function etagOf(response: ApiResponse<{ version: number }>): string {
  return response.etag ?? `"${response.data.version}"`;
}

export interface OrderWithEtag {
  order: OrderDetails;
  etag: string;
}

function withEtag(response: ApiResponse<OrderDetails>): OrderWithEtag {
  return { order: response.data, etag: etagOf(response) };
}

export const ordersApi = {
  async list(params: OrderListParams, signal?: AbortSignal): Promise<OrderListResponse> {
    const response = await apiRequest<OrderListResponse>('/orders', {
      query: params as Record<string, string | string[] | number | boolean | undefined>,
      ...(signal ? { signal } : {}),
    });
    return response.data;
  },

  async get(id: string, signal?: AbortSignal): Promise<OrderWithEtag> {
    return withEtag(await apiRequest<OrderDetails>(`/orders/${id}`, signal ? { signal } : {}));
  },

  async audit(
    id: string,
    params: { order?: 'asc' | 'desc'; page?: number; pageSize?: number } = {},
    signal?: AbortSignal,
  ): Promise<AuditListResponse> {
    const response = await apiRequest<AuditListResponse>(`/orders/${id}/audit`, {
      query: params,
      ...(signal ? { signal } : {}),
    });
    return response.data;
  },

  async changeStatus(
    id: string,
    input: { status: string; comment?: string },
    ifMatch: string,
    idempotencyKey?: string,
  ): Promise<OrderWithEtag> {
    return withEtag(
      await apiRequest<OrderDetails>(`/orders/${id}/status`, {
        method: 'PATCH',
        body: input,
        ifMatch,
        idempotencyKey,
      }),
    );
  },

  async assignCourier(
    id: string,
    courierId: string,
    ifMatch: string,
    idempotencyKey?: string,
  ): Promise<OrderWithEtag> {
    return withEtag(
      await apiRequest<OrderDetails>(`/orders/${id}/courier`, {
        method: 'PUT',
        body: { courierId },
        ifMatch,
        idempotencyKey,
      }),
    );
  },

  async unassignCourier(
    id: string,
    ifMatch: string,
    idempotencyKey?: string,
  ): Promise<OrderWithEtag> {
    return withEtag(
      await apiRequest<OrderDetails>(`/orders/${id}/courier`, {
        method: 'DELETE',
        ifMatch,
        idempotencyKey,
      }),
    );
  },

  async cancel(
    id: string,
    reason: string,
    ifMatch: string,
    idempotencyKey?: string,
  ): Promise<OrderWithEtag> {
    return withEtag(
      await apiRequest<OrderDetails>(`/orders/${id}/cancel`, {
        method: 'POST',
        body: { reason },
        ifMatch,
        idempotencyKey,
      }),
    );
  },

  async restaurants(signal?: AbortSignal): Promise<Restaurant[]> {
    const response = await apiRequest<Restaurant[]>('/restaurants', signal ? { signal } : {});
    return response.data;
  },

  async couriers(signal?: AbortSignal): Promise<Courier[]> {
    const response = await apiRequest<Courier[]>('/couriers', signal ? { signal } : {});
    return response.data;
  },
};
