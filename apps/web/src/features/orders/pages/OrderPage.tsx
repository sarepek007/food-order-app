import {
  ORDER_STATUS_LABELS,
  nextProgressStatuses,
  type OrderChangeEvent,
  type OrderStatus,
} from '@food/contracts';
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuditQuery, useOrderMutation, useOrderQuery, type OrderMutationInput } from '@/api/queries';
import { useOrderStream } from '@/api/stream';
import { errorMessage, isApiError, isNetworkError, type ApiError } from '@/api/errors';
import { Button } from '@/components/Button';
import { ArrowLeftIcon, ArrowRightIcon, CancelIcon, CourierIcon, MinusIcon, SwapIcon } from '@/components/icons';
import { SlaIndicator } from '@/components/SlaIndicator';
import { StatusBadge } from '@/components/StatusBadge';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { useToast } from '@/components/Toaster';
import { formatDateTime, formatMoney, formatPhone, formatRelative } from '@/lib/format';
import { AuditTimeline } from '../components/AuditTimeline';
import { CancelDialog } from '../components/CancelDialog';
import { ConflictBanner, type ConflictInfo } from '../components/ConflictBanner';
import { CourierDialog } from '../components/CourierDialog';
import { LiveChangeNotice } from '../components/LiveChangeNotice';

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
  const [liveChange, setLiveChange] = useState<OrderChangeEvent | null>(null);

  const etag = orderQuery.data?.etag ?? null;
  const currentVersion = orderQuery.data?.order.version ?? 0;

  const handleLiveChange = useCallback(
    (event: OrderChangeEvent) => {
      // Своё же изменение приходит тем же потоком: его версия не выше той,
      // что уже лежит в кэше, — показывать о нём уведомление незачем.
      if (event.version !== null && event.version <= currentVersion) {
        return;
      }

      setLiveChange(event);
      void orderQuery.refetch();
      void auditQuery.refetch();
    },
    [currentVersion, orderQuery, auditQuery],
  );

  const handleReconnect = useCallback(() => {
    // За время обрыва события могли пройти мимо — перечитываем состояние.
    void orderQuery.refetch();
    void auditQuery.refetch();
  }, [orderQuery, auditQuery]);

  useOrderStream({
    orderId: id,
    onChange: handleLiveChange,
    onReconnect: handleReconnect,
    enabled: Boolean(id),
  });

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
            setLiveChange(null);
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
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl bg-surface p-5 shadow-card ring-1 ring-line">
          <CardSkeleton lines={8} />
        </div>
        <div className="rounded-xl bg-surface p-5 shadow-card ring-1 ring-line">
          <CardSkeleton lines={5} />
        </div>
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
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
      <Link
        to="/orders"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted transition-colors hover:text-accent"
      >
        <ArrowLeftIcon className="size-3.5" />
        Все заказы
      </Link>

      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          {`Заказ №${order.publicNumber}`}
        </h1>
        {/* Точка привязки для e2e: в журнале те же названия статусов,
            и без неё селектор становится неоднозначным. */}
        <span data-testid="order-status">
          <StatusBadge status={order.status} size="md" />
        </span>
        <span className="text-sm">
          <SlaIndicator
            state={order.slaState}
            secondsInStatus={order.secondsInStatus}
            limitSeconds={order.slaLimitSeconds}
          />
        </span>
        <span className="tabular rounded-md bg-surface-muted px-2 py-0.5 text-xs text-muted ring-1 ring-line">
          {`версия ${order.version}`}
        </span>
      </header>

      {liveChange && !conflict && (
        <LiveChangeNotice event={liveChange} onDismiss={() => setLiveChange(null)} />
      )}

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
        <div
          role="alert"
          className="flex gap-3 rounded-xl bg-danger-soft p-4 text-sm ring-1 ring-red-200"
        >
          <CancelIcon className="mt-0.5 size-5 shrink-0 text-danger" />
          <div>
            <p className="font-medium text-danger">{actionError.problem.title}</p>
            <p className="mt-0.5 text-ink-soft">{actionError.message}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="flex flex-col gap-4">
          <div className="rounded-xl bg-surface p-5 shadow-card ring-1 ring-line">
            <h2 className="mb-4 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Данные заказа
            </h2>
            <dl className="grid grid-cols-1 gap-y-2.5 text-sm sm:grid-cols-[9.5rem_1fr] sm:gap-y-2">
              {/* Технический идентификатор: в списке показывается короткий
                  человекочитаемый номер, а полный UUID нужен для обращений
                  в поддержку и для поиска в логах. */}
              <dt className="text-muted">Идентификатор</dt>
              <dd className="font-mono text-xs break-all text-ink-soft select-all">{order.id}</dd>

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
              <dd data-testid="order-courier">
                {order.courier?.name ?? <span className="text-faint">не назначен</span>}
              </dd>

              <dt className="text-muted">Адрес доставки</dt>
              <dd>{order.deliveryAddress}</dd>

              <dt className="text-muted">Сумма</dt>
              <dd className="tabular font-medium">{formatMoney(order.totalAmount, order.currency)}</dd>

              <dt className="text-muted">Создан</dt>
              <dd title={formatDateTime(order.createdAt)}>{formatDateTime(order.createdAt)}</dd>

              <dt className="text-muted">Изменён</dt>
              <dd title={formatDateTime(order.updatedAt)}>{formatRelative(order.updatedAt)}</dd>

              <dt className="text-muted">Статус с</dt>
              <dd title={formatDateTime(order.statusChangedAt)}>
                {formatRelative(order.statusChangedAt)}
              </dd>

              {order.cancelReason && (
                <>
                  <dt className="text-muted">Причина отмены</dt>
                  <dd className="text-danger">{order.cancelReason}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="rounded-xl bg-surface p-5 shadow-card ring-1 ring-line">
            <h2 className="mb-4 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Действия
            </h2>

            <div className="flex flex-wrap gap-2">
              {/* Кнопки строятся по графу переходов из @food/contracts:
                  недопустимое действие не показывается вовсе. */}
              {transitions.map((status) => (
                <Button
                  key={status}
                  variant="primary"
                  loading={busy}
                  icon={<ArrowRightIcon />}
                  onClick={() => run({ kind: 'status', status })}
                >
                  {`Перевести в «${ORDER_STATUS_LABELS[status]}»`}
                </Button>
              ))}

              {!order.allowedTransitions.length && (
                <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted">
                  Заказ в терминальном статусе — изменения больше недоступны.
                </p>
              )}

              {order.status !== 'delivered' && order.status !== 'cancelled' && (
                <>
                  <Button
                    onClick={() => setCourierDialog(true)}
                    disabled={busy}
                    icon={order.courier ? <SwapIcon /> : <CourierIcon />}
                  >
                    {order.courier ? 'Сменить курьера' : 'Назначить курьера'}
                  </Button>

                  {order.courier && !['ready', 'picked_up'].includes(order.status) && (
                    <Button
                      onClick={() => run({ kind: 'unassign-courier' })}
                      loading={busy}
                      icon={<MinusIcon />}
                    >
                      Снять курьера
                    </Button>
                  )}
                </>
              )}

              {order.cancellable && (
                <Button
                  variant="danger"
                  onClick={() => setCancelDialog(true)}
                  disabled={busy}
                  icon={<CancelIcon />}
                >
                  Отменить заказ
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl bg-surface p-5 shadow-card ring-1 ring-line">
          <h2 className="mb-4 text-[11px] font-semibold tracking-wide text-muted uppercase">
            История изменений
          </h2>

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
