import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, server } from '@/test/server';
import { COURIER_FREE, COURIER_FULL, makeAudit, makeOrder, problem } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { OrderPage } from './OrderPage';

const ORDER_ID = '00000000-0000-4000-8000-000000000042';

function render() {
  return renderWithProviders(<OrderPage />, {
    route: `/orders/${ORDER_ID}`,
    path: '/orders/:id',
  });
}

function serveOrder(order = makeOrder(), etag = `"${order.version}"`) {
  server.use(http.get(`${API}/orders/:id`, () => HttpResponse.json(order, { headers: { ETag: etag } })));
  return order;
}

function serveAudit(entries: Parameters<typeof makeAudit>[0]) {
  const items = makeAudit(entries);
  server.use(
    http.get(`${API}/orders/:id/audit`, () =>
      HttpResponse.json({ items, page: 1, pageSize: 100, total: items.length, totalPages: 1 }),
    ),
  );
}

describe('загрузка карточки', () => {
  it('показывает скелет до получения данных', async () => {
    server.use(
      http.get(`${API}/orders/:id`, async () => {
        await delay(40);
        return HttpResponse.json(makeOrder(), { headers: { ETag: '"1"' } });
      }),
    );

    render();
    expect(screen.queryByText(/Заказ №/)).not.toBeInTheDocument();
    expect(await screen.findByText(/Заказ №/)).toBeInTheDocument();
  });

  it('показывает все требуемые поля заказа', async () => {
    serveOrder(
      makeOrder({
        status: 'preparing',
        courier: { id: COURIER_FREE.id, name: COURIER_FREE.name },
        deliveryAddress: 'Ленинский проспект, д. 12',
        totalAmount: '1290.50',
        version: 4,
      }),
    );

    render();

    expect(await screen.findByText(/Заказ №/)).toBeInTheDocument();
    expect(screen.getByText('Готовится')).toBeInTheDocument();
    expect(screen.getByText('Пётр Клиентов')).toBeInTheDocument();
    expect(screen.getByText('Пушкин')).toBeInTheDocument();
    expect(screen.getByText(COURIER_FREE.name)).toBeInTheDocument();
    expect(screen.getByText('Ленинский проспект, д. 12')).toBeInTheDocument();
    expect(screen.getByText(/1\s?290,50/)).toBeInTheDocument();
    expect(screen.getByText('версия 4')).toBeInTheDocument();
  });

  it('показывает журнал изменений', async () => {
    serveOrder();
    serveAudit([
      { action: 'ORDER_CREATED', oldStatus: null, newStatus: 'new', actor: 'система' },
      {
        action: 'COURIER_ASSIGNED',
        newCourier: { id: 'c-1', name: 'Иван Соколов' },
        actor: 'Анна Петрова',
      },
      { action: 'STATUS_CHANGED', oldStatus: 'new', newStatus: 'accepted', comment: 'подтверждено' },
    ]);

    render();

    const history = (await screen.findByText('История изменений')).closest('section')!;
    expect(within(history).getByText('Заказ создан')).toBeInTheDocument();
    expect(within(history).getByText(/Иван Соколов/)).toBeInTheDocument();
    expect(within(history).getByText(/Новый → Принят/)).toBeInTheDocument();
    expect(within(history).getByText('«подтверждено»')).toBeInTheDocument();
  });

  it('несуществующий заказ показывает понятное сообщение, а не ошибку', async () => {
    server.use(
      http.get(`${API}/orders/:id`, () =>
        HttpResponse.json(problem('ORDER_NOT_FOUND', 404, 'Заказ не найден'), { status: 404 }),
      ),
    );

    render();
    expect(await screen.findByText('Заказ не найден')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Вернуться к списку' })).toBeInTheDocument();
  });

  it('обрыв связи предлагает повторить', async () => {
    let attempt = 0;
    server.use(
      http.get(`${API}/orders/:id`, () => {
        attempt += 1;
        return attempt === 1
          ? HttpResponse.error()
          : HttpResponse.json(makeOrder(), { headers: { ETag: '"1"' } });
      }),
    );

    const { user } = render();
    expect(await screen.findByText('Нет связи с сервером')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText(/Заказ №/)).toBeInTheDocument();
  });
});

describe('доступные действия', () => {
  it('показывает только разрешённые переходы', async () => {
    serveOrder(makeOrder({ status: 'new' }));
    render();

    expect(await screen.findByRole('button', { name: 'Перевести в «Принят»' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Доставлен/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Готов к выдаче/ })).not.toBeInTheDocument();
  });

  it('у терминального заказа действий нет', async () => {
    serveOrder(makeOrder({ status: 'delivered', courier: { id: 'c-1', name: 'Иван' } }));
    render();

    expect(await screen.findByText(/терминальном статусе/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отменить заказ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /курьера/ })).not.toBeInTheDocument();
  });

  it('не предлагает отмену после передачи курьеру', async () => {
    serveOrder(makeOrder({ status: 'picked_up', courier: { id: 'c-1', name: 'Иван' } }));
    render();

    expect(await screen.findByRole('button', { name: 'Перевести в «Доставлен»' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отменить заказ' })).not.toBeInTheDocument();
  });

  it('не предлагает снять курьера с заказа в доставке', async () => {
    serveOrder(makeOrder({ status: 'ready', courier: { id: 'c-1', name: 'Иван' } }));
    render();

    expect(await screen.findByRole('button', { name: 'Сменить курьера' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Снять курьера' })).not.toBeInTheDocument();
  });
});

describe('изменение статуса', () => {
  it('отправляет версию заказа в If-Match', async () => {
    serveOrder(makeOrder({ status: 'new', version: 7 }), '"7"');

    let ifMatch: string | null = null;
    server.use(
      http.patch(`${API}/orders/:id/status`, ({ request }) => {
        ifMatch = request.headers.get('If-Match');
        return HttpResponse.json(makeOrder({ status: 'accepted', version: 8 }), {
          headers: { ETag: '"8"' },
        });
      }),
    );

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Перевести в «Принят»' }));

    await waitFor(() => expect(ifMatch).toBe('"7"'));
    expect(await screen.findByText('Изменение сохранено')).toBeInTheDocument();
  });

  it('передаёт имя оператора в X-Actor', async () => {
    serveOrder(makeOrder({ status: 'new' }));

    let actor: string | null = null;
    server.use(
      http.patch(`${API}/orders/:id/status`, ({ request }) => {
        actor = request.headers.get('X-Actor');
        return HttpResponse.json(makeOrder({ status: 'accepted', version: 2 }));
      }),
    );

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Перевести в «Принят»' }));

    await waitFor(() => expect(actor).toBeTruthy());
    // Кириллица кодируется процентами: значения заголовков — байты latin-1.
    expect(decodeURIComponent(actor!)).toBe('Оператор');
  });

  it('недопустимый переход показывает объяснение сервера', async () => {
    serveOrder(makeOrder({ status: 'new' }));
    server.use(
      http.patch(`${API}/orders/:id/status`, () =>
        HttpResponse.json(
          problem(
            'ORDER_INVALID_TRANSITION',
            409,
            'Из статуса «Новый» нельзя перейти в «Доставлен».',
            { currentStatus: 'new', allowedStatuses: ['accepted', 'cancelled'] },
          ),
          { status: 409 },
        ),
      ),
    );

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Перевести в «Принят»' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((node) => node.textContent?.includes('нельзя перейти'))).toBe(true);
  });
});

describe('назначение курьера', () => {
  it('показывает загрузку курьеров и блокирует переполненных', async () => {
    serveOrder(makeOrder({ status: 'accepted' }));

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Назначить курьера' }));

    const free = await screen.findByRole('radio', { name: new RegExp(COURIER_FREE.name) });
    expect(free).toBeEnabled();
    expect(screen.getByText('1/3 активных')).toBeInTheDocument();

    expect(screen.getByRole('radio', { name: new RegExp(COURIER_FULL.name) })).toBeDisabled();
    expect(screen.getByText(/нет свободных слотов \(3\/3\)/)).toBeInTheDocument();
  });

  it('превышение лимита на сервере показывается понятным текстом', async () => {
    serveOrder(makeOrder({ status: 'ready', courier: { id: 'c-9', name: 'Пётр' } }));
    server.use(
      http.put(`${API}/orders/:id/courier`, () =>
        HttpResponse.json(
          problem(
            'COURIER_CAPACITY_EXCEEDED',
            409,
            'Курьер Иван Соколов уже везёт 3 заказа — это максимум (3).',
            { courierName: 'Иван Соколов', activeCount: 3, limit: 3 },
          ),
          { status: 409 },
        ),
      ),
    );

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Сменить курьера' }));
    await user.click(await screen.findByRole('radio', { name: new RegExp(COURIER_FREE.name) }));
    await user.click(screen.getByRole('button', { name: 'Назначить' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((node) => node.textContent?.includes('это максимум'))).toBe(true);
  });
});

describe('отмена заказа', () => {
  it('не отправляет запрос без причины', async () => {
    serveOrder(makeOrder({ status: 'new' }));

    let called = false;
    server.use(
      http.post(`${API}/orders/:id/cancel`, () => {
        called = true;
        return HttpResponse.json(makeOrder({ status: 'cancelled' }));
      }),
    );

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Отменить заказ' }));
    await user.click(screen.getAllByRole('button', { name: 'Отменить заказ' }).at(-1)!);

    expect(await screen.findByText('Укажите причину отмены')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('отправляет причину и сообщает об успехе', async () => {
    serveOrder(makeOrder({ status: 'new' }));

    let sent: unknown = null;
    server.use(
      http.post(`${API}/orders/:id/cancel`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          makeOrder({ status: 'cancelled', cancelReason: 'клиент передумал', version: 2 }),
          { headers: { ETag: '"2"' } },
        );
      }),
    );

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Отменить заказ' }));
    await user.type(screen.getByLabelText('Причина отмены'), 'клиент передумал');
    await user.click(screen.getAllByRole('button', { name: 'Отменить заказ' }).at(-1)!);

    await waitFor(() => expect(sent).toEqual({ reason: 'клиент передумал' }));
    expect(await screen.findByText('Изменение сохранено')).toBeInTheDocument();
  });

  it('ошибку валидации от сервера показывает у поля', async () => {
    serveOrder(makeOrder({ status: 'new' }));
    server.use(
      http.post(`${API}/orders/:id/cancel`, () =>
        HttpResponse.json(
          problem('VALIDATION_FAILED', 400, 'Запрос не прошёл валидацию', {
            issues: [{ path: 'reason', message: 'Укажите причину отмены' }],
          }),
          { status: 400 },
        ),
      ),
    );

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Отменить заказ' }));
    await user.type(screen.getByLabelText('Причина отмены'), 'ок');
    await user.click(screen.getAllByRole('button', { name: 'Отменить заказ' }).at(-1)!);

    expect(await screen.findByText('Укажите причину отмены')).toBeInTheDocument();
    // Модалка не закрывается: оператор не теряет введённый текст.
    expect(screen.getByLabelText('Причина отмены')).toHaveValue('ок');
  });
});

describe('конкурентное изменение', () => {
  const conflictProblem = problem(
    'ORDER_VERSION_CONFLICT',
    409,
    'Пока вы работали с заказом, его изменил другой пользователь (оператор B): назначен курьер Alex.',
    {
      expectedVersion: 1,
      actualVersion: 2,
      changedFields: ['courierId'],
      changes: ['назначен курьер Alex'],
      current: makeOrder({ status: 'new', version: 2, courier: { id: 'c-alex', name: 'Alex' } }),
    },
  );

  it('показывает разбор конфликта вместо тихой перезаписи', async () => {
    serveOrder(makeOrder({ status: 'new', version: 1 }), '"1"');
    server.use(
      http.patch(`${API}/orders/:id/status`, () => HttpResponse.json(conflictProblem, { status: 409 })),
    );

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Перевести в «Принят»' }));

    const banner = await screen.findByTestId('conflict-banner');
    expect(within(banner).getByText('Заказ изменён другим пользователем')).toBeInTheDocument();
    expect(within(banner).getByText('назначен курьер Alex')).toBeInTheDocument();
    expect(within(banner).getByText(/Ваша версия — 1/)).toBeInTheDocument();
    expect(within(banner).getByText(/перевод в статус «Принят» — не применено/)).toBeInTheDocument();
  });

  it('повторяет действие поверх актуального состояния по кнопке', async () => {
    serveOrder(makeOrder({ status: 'new', version: 1 }), '"1"');

    const headers: (string | null)[] = [];
    let attempt = 0;
    server.use(
      http.patch(`${API}/orders/:id/status`, ({ request }) => {
        headers.push(request.headers.get('If-Match'));
        attempt += 1;
        return attempt === 1
          ? HttpResponse.json(conflictProblem, { status: 409 })
          : HttpResponse.json(makeOrder({ status: 'accepted', version: 3 }), {
              headers: { ETag: '"3"' },
            });
      }),
    );

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Перевести в «Принят»' }));
    await screen.findByTestId('conflict-banner');

    await user.click(screen.getByRole('button', { name: 'Применить моё изменение поверх' }));

    await waitFor(() => expect(headers).toEqual(['"1"', '*']));
    expect(await screen.findByText('Изменение сохранено')).toBeInTheDocument();
    expect(screen.queryByTestId('conflict-banner')).not.toBeInTheDocument();
  });

  it('по кнопке «посмотреть актуальный» перечитывает заказ', async () => {
    let requests = 0;
    server.use(
      http.get(`${API}/orders/:id`, () => {
        requests += 1;
        const order =
          requests === 1
            ? makeOrder({ status: 'new', version: 1 })
            : makeOrder({ status: 'new', version: 2, courier: { id: 'c-alex', name: 'Alex' } });
        return HttpResponse.json(order, { headers: { ETag: `"${order.version}"` } });
      }),
      http.patch(`${API}/orders/:id/status`, () => HttpResponse.json(conflictProblem, { status: 409 })),
    );

    const { user } = render();
    await user.click(await screen.findByRole('button', { name: 'Перевести в «Принят»' }));
    await screen.findByTestId('conflict-banner');

    await user.click(screen.getByRole('button', { name: 'Посмотреть актуальный заказ' }));

    await waitFor(() => expect(screen.queryByTestId('conflict-banner')).not.toBeInTheDocument());
    expect(await screen.findByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('версия 2')).toBeInTheDocument();
  });
});
