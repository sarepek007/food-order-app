import { ORDER_STATUS_LABELS, nextProgressStatuses, type OrderStatus } from '@food/contracts';
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuditQuery, useOrderMutation, useOrderQuery, type OrderMutationInput } from '@/api/queries';
import { errorMessage, isApiError, isNetworkError, type ApiError } from '@/api/errors';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { useToast } from '@/components/Toaster';
import { formatDateTime, formatMoney, formatPhone, formatRelative } from '@/lib/format';
import { AuditTimeline } from './AuditTimeline';
import { CancelDialog } from './CancelDialog';
import { ConflictBanner, type ConflictInfo } from './ConflictBanner';
import { CourierDialog } from './CourierDialog';

/** Человекочитаемое описание попытки — для баннера конфликта. */
function describeAttempt(input: OrderMutationInput): string {
  switch (input.kind) {
    case 'status':
      return `перевод в статус «${ORDER_STATUS_LABELS[input.status as OrderStatus]}»`;
    case 'assign-courier':
      return 'назначение курьера';
    case 'unassign-courier':
      return 'снятие курьера';
    case 'cancel':
      return 'отмена заказа';
  }
}

export function OrderPage() {
  const { id = '' } = useParams();
  const toast = useToast();

  const orderQuery = useOrderQuery(id);
  const auditQuery = useAuditQuery(id);
  const mutation = useOrderMutation(id);

  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [lastAttempt, setLastAttempt] = useState<OrderMutationInput | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [courierDialog, setCourierDialog] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);

  const etag = orderQuery.data?.etag ?? null;

  const run = useCallback(
    (input: OrderMutationInput, options: { force?: boolean } = {}) => {
      if (!etag && !options.force) return;

      setLastAttempt(input);
      setActionError(null);

      mutation.mutate(
        { input, ifMatch: options.force ? '*' : etag! },
        {
          onSuccess: () => {
            setConflict(null);
            setCourierDialog(false);
            setCancelDialog(false);
            toast.success('Изменение сохранено');
          },
          onError: (error) => {
            if (isApiError(error) && error.isConflict) {
              // Конфликт — не ошибка формы: показываем разбор, а не тост.
              setConflict(error.details as ConflictInfo);
              return;
            }
            if (isApiError(error)) {
              setActionError(error);
              if (!error.isValidation) toast.error(error.message);
              return;
            }
            toast.error(errorMessage(error));
          },
        },
      );
    },
    [etag, mutation, toast],
  );

  if (orderQuery.isLoading) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <CardSkeleton lines={8} />
      </div>
    );
  }

  if (orderQuery.isError) {
    const notFound = isApiError(orderQuery.error) && orderQuery.error.isNotFound;
    return (
      <div className="mx-auto max-w-3xl p-6">
        {notFound ? (
          <EmptyState
            title="Заказ не найден"
            description="Возможно, он был удалён или ссылка неверна."
            action={
              <Link to="/orders" className="text-sm text-accent hover:underline">
                Вернуться к списку
              </Link>
            }
          />
        ) : (
          <ErrorState
            title={isNetworkError(orderQuery.error) ? 'Нет связи с сервером' : 'Не удалось загрузить заказ'}
            description={errorMessage(orderQuery.error)}
            onRetry={() => void orderQuery.refetch()}
            retrying={orderQuery.isFetching}
          />
        )}
      </div>
    );
  }

  const order = orderQuery.data!.order;
  const transitions = nextProgressStatuses(order.status);
  const busy = mutation.isPending;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <div>
        <Link to="/orders" className="text-sm text-accent hover:underline">
          ← Все заказы
        </Link>
      </div>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Заказ №{order.publicNumber}</h1>
        <StatusBadge status={order.status} />
        <span className="text-xs text-muted">версия {order.version}</span>
      </header>

      {conflict && (
        <ConflictBanner
          conflict={conflict}
          attemptDescription={lastAttempt ? describeAttempt(lastAttempt) : null}
          forcing={busy}
          onDismiss={() => {
            setConflict(null);
            void orderQuery.refetch();
            void auditQuery.refetch();
          }}
          onForce={() => lastAttempt && run(lastAttempt, { force: true })}
        />
      )}

      {actionError && !actionError.isValidation && (
        <div role="alert" className="rounded-lg bg-danger-soft p-4 text-sm ring-1 ring-red-200">
          <p className="font-medium text-danger">{actionError.problem.title}</p>
          <p className="mt-1 text-ink">{actionError.message}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="flex flex-col gap-4">
          <div className="rounded-lg bg-surface p-5 ring-1 ring-line">
            <h2 className="mb-3 text-sm font-semibold text-muted">Данные заказа</h2>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted">Клиент</dt>
              <dd>
                {order.customerName}
                <span className="ml-2 text-muted">{formatPhone(order.customerPhone)}</span>
              </dd>

              <dt className="text-muted">Ресторан</dt>
              <dd>
                {order.restaurant.name}
                <span className="ml-2 text-muted">{order.restaurant.address}</span>
              </dd>

              <dt className="text-muted">Курьер</dt>
              <dd>{order.courier?.name ?? <span className="text-slate-400">не назначен</span>}</dd>

              <dt className="text-muted">Адрес доставки</dt>
              <dd>{order.deliveryAddress}</dd>

              <dt className="text-muted">Сумма</dt>
              <dd className="tabular-nums">{formatMoney(order.totalAmount, order.currency)}</dd>

              <dt className="text-muted">Создан</dt>
              <dd title={formatDateTime(order.createdAt)}>{formatDateTime(order.createdAt)}</dd>

              <dt className="text-muted">Изменён</dt>
              <dd title={formatDateTime(order.updatedAt)}>{formatRelative(order.updatedAt)}</dd>

              {order.cancelReason && (
                <>
                  <dt className="text-muted">Причина отмены</dt>
                  <dd className="text-danger">{order.cancelReason}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="rounded-lg bg-surface p-5 ring-1 ring-line">
            <h2 className="mb-3 text-sm font-semibold text-muted">Действия</h2>

            <div className="flex flex-wrap gap-2">
              {/* Кнопки строятся по графу переходов из @food/contracts:
                  недопустимое действие не показывается вовсе. */}
              {transitions.map((status) => (
                <Button
                  key={status}
                  variant="primary"
                  loading={busy}
                  onClick={() => run({ kind: 'status', status })}
                >
                  Перевести в «{ORDER_STATUS_LABELS[status]}»
                </Button>
              ))}

              {!order.allowedTransitions.length && (
                <p className="text-sm text-muted">
                  Заказ в терминальном статусе — изменения больше недоступны.
                </p>
              )}

              {order.status !== 'delivered' && order.status !== 'cancelled' && (
                <>
                  <Button onClick={() => setCourierDialog(true)} disabled={busy}>
                    {order.courier ? 'Сменить курьера' : 'Назначить курьера'}
                  </Button>

                  {order.courier && !['ready', 'picked_up'].includes(order.status) && (
                    <Button
                      onClick={() => run({ kind: 'unassign-courier' })}
                      loading={busy}
                    >
                      Снять курьера
                    </Button>
                  )}
                </>
              )}

              {order.cancellable && (
                <Button variant="danger" onClick={() => setCancelDialog(true)} disabled={busy}>
                  Отменить заказ
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg bg-surface p-5 ring-1 ring-line">
          <h2 className="mb-4 text-sm font-semibold text-muted">История изменений</h2>

          {auditQuery.isLoading && <CardSkeleton lines={4} />}

          {auditQuery.isError && (
            <ErrorState
              title="Не удалось загрузить историю"
              description={errorMessage(auditQuery.error)}
              onRetry={() => void auditQuery.refetch()}
            />
          )}

          {auditQuery.data && auditQuery.data.items.length === 0 && (
            <EmptyState title="Событий пока нет" />
          )}

          {auditQuery.data && auditQuery.data.items.length > 0 && (
            <AuditTimeline entries={auditQuery.data.items} />
          )}
        </section>
      </div>

      <CourierDialog
        open={courierDialog}
        order={order}
        busy={busy}
        onClose={() => setCourierDialog(false)}
        onSelect={(courierId) => run({ kind: 'assign-courier', courierId })}
      />

      <CancelDialog
        open={cancelDialog}
        publicNumber={order.publicNumber}
        busy={busy}
        fieldError={actionError?.isValidation ? (actionError.fieldIssues[0]?.message ?? null) : null}
        onClose={() => {
          setCancelDialog(false);
          setActionError(null);
        }}
        onConfirm={(reason) => run({ kind: 'cancel', reason })}
      />
    </div>
  );
}
