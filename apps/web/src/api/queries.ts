import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { AuditListResponse, Courier, OrderListResponse, Restaurant } from '@food/contracts';
import { ordersApi, type OrderListParams, type OrderWithEtag } from './orders.js';
import { ApiError } from './errors.js';


/**
 * Ключи кэша собраны в одном месте: инвалидация после мутации должна попадать
 * ровно в те запросы, которые изменились, иначе список «залипает».
 */
export const queryKeys = {
  orders: (params: OrderListParams) => ['orders', params] as const,
  order: (id: string) => ['order', id] as const,
  audit: (id: string) => ['order', id, 'audit'] as const,
  restaurants: () => ['restaurants'] as const,
  couriers: () => ['couriers'] as const,
};

export function useOrdersQuery(params: OrderListParams): UseQueryResult<OrderListResponse, Error> {
  return useQuery({
    queryKey: queryKeys.orders(params),
    queryFn: ({ signal }) => ordersApi.list(params, signal),
    // Данные оперативные: считаем их устаревшими сразу, но при смене страницы
    // показываем предыдущие, чтобы таблица не мигала.
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useOrderQuery(id: string): UseQueryResult<OrderWithEtag, Error> {
  return useQuery({
    queryKey: queryKeys.order(id),
    queryFn: ({ signal }) => ordersApi.get(id, signal),
    // Политика повторов задана в createQueryClient: 4xx не повторяются.
  });
}

export function useAuditQuery(id: string): UseQueryResult<AuditListResponse, Error> {
  return useQuery({
    queryKey: queryKeys.audit(id),
    queryFn: ({ signal }) => ordersApi.audit(id, { order: 'desc', pageSize: 100 }, signal),
    enabled: Boolean(id),
  });
}

export function useRestaurantsQuery(): UseQueryResult<Restaurant[], Error> {
  return useQuery({
    queryKey: queryKeys.restaurants(),
    queryFn: ({ signal }) => ordersApi.restaurants(signal),
    // Справочник меняется редко — лишние запросы при каждом открытии не нужны.
    staleTime: 5 * 60 * 1000,
  });
}

export function useCouriersQuery(): UseQueryResult<Courier[], Error> {
  return useQuery({
    queryKey: queryKeys.couriers(),
    queryFn: ({ signal }) => ordersApi.couriers(signal),
    // Загрузка курьеров меняется вместе с заказами, поэтому кэш короткий.
    staleTime: 15 * 1000,
  });
}

export type OrderMutationInput =
  | { kind: 'status'; status: string; comment?: string }
  | { kind: 'assign-courier'; courierId: string }
  | { kind: 'unassign-courier' }
  | { kind: 'cancel'; reason: string };

export interface OrderMutationVariables {
  input: OrderMutationInput;
  /** Версия, на которой оператор принимал решение. '*' — «применить поверх». */
  ifMatch: string;
}

/**
 * Все действия над заказом идут через одну мутацию: у них общий протокол
 * (If-Match на входе, обновлённый заказ на выходе) и общая обработка ошибок.
 */
export function useOrderMutation(
  id: string,
): UseMutationResult<OrderWithEtag, Error, OrderMutationVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ input, ifMatch }: OrderMutationVariables) => {
      switch (input.kind) {
        case 'status':
          return ordersApi.changeStatus(
            id,
            input.comment ? { status: input.status, comment: input.comment } : { status: input.status },
            ifMatch,
          );
        case 'assign-courier':
          return ordersApi.assignCourier(id, input.courierId, ifMatch);
        case 'unassign-courier':
          return ordersApi.unassignCourier(id, ifMatch);
        case 'cancel':
          return ordersApi.cancel(id, input.reason, ifMatch);
      }
    },
    onSuccess: (result) => {
      // Свежий заказ кладём в кэш сразу: карточка не мигает лоадером.
      queryClient.setQueryData(queryKeys.order(id), result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit(id) });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      // Назначение курьера меняет его загрузку в справочнике.
      void queryClient.invalidateQueries({ queryKey: queryKeys.couriers() });
    },
    onError: (error) => {
      // Конфликт означает, что наш кэш устарел: подтягиваем актуальное состояние.
      if (error instanceof ApiError && error.isConflict) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.order(id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.audit(id) });
      }
    },
  });
}
