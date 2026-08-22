import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, server } from '@/test/server';
import { makeList, makeOrder, problem } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { OrdersPage } from './OrdersPage';

function render(route = '/orders') {
  return renderWithProviders(<OrdersPage />, { route });
}

function currentSearch(): string {
  return screen.getByTestId('location').textContent ?? '';
}

describe('состояние загрузки', () => {
  it('показывает скелет таблицы, пока данные не пришли', async () => {
    server.use(
      http.get(`${API}/orders`, async () => {
        await delay(50);
        return HttpResponse.json(makeList([makeOrder()]));
      }),
    );

    render();

    // Заголовки таблицы видны сразу — макет не «прыгает» после загрузки.
    expect(screen.getByRole('columnheader', { name: /Клиент/ })).toBeInTheDocument();
    expect(screen.queryByText('Пётр Клиентов')).not.toBeInTheDocument();

    expect(await screen.findByText('Пётр Клиентов')).toBeInTheDocument();
  });
});

describe('успешная загрузка', () => {
  it('показывает заказы и общее количество', async () => {
    server.use(
      http.get(`${API}/orders`, () =>
        HttpResponse.json(
          makeList([
            makeOrder({ customerName: 'Пётр Клиентов', status: 'new' }),
            makeOrder({ customerName: 'Анна Клиентова', status: 'delivered' }),
          ]),
        ),
      ),
    );

    render();

    expect(await screen.findByText('Пётр Клиентов')).toBeInTheDocument();
    expect(screen.getByText('Анна Клиентова')).toBeInTheDocument();
    expect(screen.getByTestId('orders-total')).toHaveTextContent('Найдено: 2');
  });

  it('показывает все требуемые поля заказа', async () => {
    server.use(
      http.get(`${API}/orders`, () =>
        HttpResponse.json(
          makeList([
            makeOrder({
              status: 'preparing',
              courier: { id: 'c-1', name: 'Иван Соколов' },
              deliveryAddress: 'Ленинский проспект, д. 12',
              totalAmount: '1290.50',
            }),
          ]),
        ),
      ),
    );

    render();

    const row = (await screen.findByText('Пётр Клиентов')).closest('tr')!;
    expect(within(row).getByText('Готовится')).toBeInTheDocument();
    expect(within(row).getByText('Пушкин')).toBeInTheDocument();
    expect(within(row).getByText('Иван Соколов')).toBeInTheDocument();
    expect(within(row).getByText('Ленинский проспект, д. 12')).toBeInTheDocument();
    expect(within(row).getByText(/1\s?290,50/)).toBeInTheDocument();
  });

  it('отмечает заказ без курьера', async () => {
    server.use(
      http.get(`${API}/orders`, () => HttpResponse.json(makeList([makeOrder({ courier: null })]))),
    );

    render();
    expect(await screen.findByText('— не назначен')).toBeInTheDocument();
  });
});

describe('пустое состояние', () => {
  it('без фильтров сообщает, что заказов нет', async () => {
    server.use(http.get(`${API}/orders`, () => HttpResponse.json(makeList([]))));

    render();

    expect(await screen.findByText('Заказов пока нет')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сбросить фильтры' })).not.toBeInTheDocument();
  });

  it('с фильтрами предлагает их сбросить', async () => {
    server.use(http.get(`${API}/orders`, () => HttpResponse.json(makeList([]))));

    const { user } = render('/orders?q=несуществующий+адрес');

    expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument();

    server.use(http.get(`${API}/orders`, () => HttpResponse.json(makeList([makeOrder()]))));
    await user.click(screen.getAllByRole('button', { name: 'Сбросить фильтры' })[0]!);

    expect(await screen.findByText('Пётр Клиентов')).toBeInTheDocument();
    expect(currentSearch()).not.toContain('q=');
  });
});

describe('состояние ошибки', () => {
  it('показывает сообщение сервера и даёт повторить', async () => {
    let attempt = 0;
    server.use(
      http.get(`${API}/orders`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(problem('INTERNAL_ERROR', 500, 'Не удалось обработать запрос'), {
            status: 500,
          });
        }
        return HttpResponse.json(makeList([makeOrder()]));
      }),
    );

    const { user } = render();

    expect(await screen.findByText('Не удалось загрузить заказы', {}, { timeout: 3000 })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Пётр Клиентов')).toBeInTheDocument();
  });

  it('отличает отсутствие связи от ошибки сервера', async () => {
    server.use(http.get(`${API}/orders`, () => HttpResponse.error()));

    render();

    expect(await screen.findByText('Сервис недоступен', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/Проверьте подключение к сети/)).toBeInTheDocument();
  });

  it('недоступный сервис объясняется словами, а не кодом состояния', async () => {
    // Так отвечает прокси, когда приложение за ним не поднялось.
    server.use(http.get(`${API}/orders`, () => new HttpResponse('', { status: 502 })));

    render();

    expect(await screen.findByText('Сервис недоступен', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/Повторите через несколько секунд/)).toBeInTheDocument();
  });

  it('ошибка валидации параметров показывается пользователю', async () => {
    server.use(
      http.get(`${API}/orders`, () =>
        HttpResponse.json(problem('VALIDATION_FAILED', 400, 'Запрос не прошёл валидацию'), {
          status: 400,
        }),
      ),
    );

    render('/orders?sort=totalAmount');
    expect(await screen.findByText('Не удалось загрузить заказы')).toBeInTheDocument();
  });
});

describe('фильтры в адресной строке', () => {
  it('выбор статуса попадает в URL и в запрос', async () => {
    const requests: string[] = [];
    server.use(
      http.get(`${API}/orders`, ({ request }) => {
        requests.push(new URL(request.url).search);
        return HttpResponse.json(makeList([makeOrder()]));
      }),
    );

    const { user } = render();
    await screen.findByText('Пётр Клиентов');

    await user.click(screen.getByRole('button', { name: 'Готовится' }));

    await waitFor(() => expect(currentSearch()).toContain('status=preparing'));
    await waitFor(() => expect(requests.at(-1)).toContain('status=preparing'));
  });

  it('фильтры восстанавливаются из адреса при открытии', async () => {
    const requests: string[] = [];
    server.use(
      http.get(`${API}/orders`, ({ request }) => {
        requests.push(new URL(request.url).search);
        return HttpResponse.json(makeList([makeOrder()]));
      }),
    );

    render('/orders?status=ready&q=Ленина&page=2');
    await screen.findByText('Пётр Клиентов');

    expect(requests[0]).toContain('status=ready');
    expect(requests[0]).toContain('q=%D0%9B%D0%B5%D0%BD%D0%B8%D0%BD%D0%B0');
    expect(requests[0]).toContain('page=2');
    expect(screen.getByRole('button', { name: 'Готов к выдаче' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('поиск отправляется с задержкой и попадает в адрес', async () => {
    const requests: string[] = [];
    server.use(
      http.get(`${API}/orders`, ({ request }) => {
        requests.push(new URL(request.url).search);
        return HttpResponse.json(makeList([makeOrder()]));
      }),
    );

    const { user } = render();
    await screen.findByText('Пётр Клиентов');

    await user.type(screen.getByLabelText('Поиск по адресу'), 'Мира');

    await waitFor(() => expect(currentSearch()).toContain('q=%D0%9C%D0%B8%D1%80%D0%B0'), {
      timeout: 2000,
    });
    // Ввод четырёх символов не должен породить четыре запроса.
    expect(requests.length).toBeLessThanOrEqual(3);
  });

  it('смена фильтра возвращает на первую страницу', async () => {
    server.use(http.get(`${API}/orders`, () => HttpResponse.json(makeList([makeOrder()]))));

    const { user } = render('/orders?page=3');
    await screen.findByText('Пётр Клиентов');

    await user.click(screen.getByRole('button', { name: 'Новый' }));

    await waitFor(() => expect(currentSearch()).not.toContain('page=3'));
  });
});

describe('нормативы времени в статусе', () => {
  it('показывает, сколько заказ находится в текущем статусе', async () => {
    server.use(
      http.get(`${API}/orders`, () =>
        HttpResponse.json(
          makeList([
            makeOrder({ status: 'preparing', secondsInStatus: 40 * 60, slaState: 'overdue' }),
          ]),
        ),
      ),
    );

    render();
    expect(await screen.findByText('40 мин')).toBeInTheDocument();
  });

  it('просроченный заказ помечен текстом, а не только цветом строки', async () => {
    server.use(
      http.get(`${API}/orders`, () =>
        HttpResponse.json(
          makeList([
            makeOrder({ status: 'preparing', secondsInStatus: 40 * 60, slaState: 'overdue' }),
          ]),
        ),
      ),
    );

    render();
    await screen.findByText('Пётр Клиентов');
    // Именно скрытая подпись для скринридера: кнопка фильтра тоже содержит
    // слово «просроченные», поэтому проверка должна быть точной.
    expect(screen.getByText('— просрочен')).toBeInTheDocument();
  });

  it('фильтр «только просроченные» уходит в URL и в запрос', async () => {
    const requests: string[] = [];
    server.use(
      http.get(`${API}/orders`, ({ request }) => {
        requests.push(new URL(request.url).search);
        return HttpResponse.json(makeList([makeOrder()]));
      }),
    );

    const { user } = render();
    await screen.findByText('Пётр Клиентов');

    await user.click(screen.getByRole('button', { name: /Только просроченные/ }));

    await waitFor(() => expect(currentSearch()).toContain('overdue=true'));
    await waitFor(() => expect(requests.at(-1)).toContain('overdue=true'));
  });

  it('фильтр восстанавливается из адреса', async () => {
    server.use(http.get(`${API}/orders`, () => HttpResponse.json(makeList([makeOrder()]))));

    render('/orders?overdue=true');
    await screen.findByText('Пётр Клиентов');

    expect(screen.getByRole('button', { name: /Только просроченные/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('сортировка по времени в статусе доступна из заголовка', async () => {
    server.use(http.get(`${API}/orders`, () => HttpResponse.json(makeList([makeOrder()]))));

    const { user } = render();
    await screen.findByText('Пётр Клиентов');

    await user.click(screen.getByRole('button', { name: /В статусе/ }));
    await waitFor(() => expect(currentSearch()).toContain('sort=timeInStatus'));
  });
});

describe('сортировка', () => {
  it('клик по заголовку меняет поле и направление', async () => {
    server.use(http.get(`${API}/orders`, () => HttpResponse.json(makeList([makeOrder()]))));

    const { user } = render();
    await screen.findByText('Пётр Клиентов');

    await user.click(screen.getByRole('button', { name: /Сумма/ }));
    await waitFor(() => expect(currentSearch()).toContain('sort=totalAmount'));

    await user.click(screen.getByRole('button', { name: /Сумма/ }));
    await waitFor(() => expect(currentSearch()).toContain('order=asc'));
  });

  it('текущая сортировка объявлена для скринридера', async () => {
    server.use(http.get(`${API}/orders`, () => HttpResponse.json(makeList([makeOrder()]))));

    render('/orders?sort=updatedAt&order=asc');
    await screen.findByText('Пётр Клиентов');

    expect(screen.getByRole('columnheader', { name: /Изменён/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });
});

describe('пагинация', () => {
  it('показывает диапазон и переключает страницы', async () => {
    server.use(
      http.get(`${API}/orders`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? 1);
        return HttpResponse.json(
          // По одному заказу на страницу: так диапазон «показаны N–N» проверяем
          // на согласованных данных, а не на искусственно урезанной выдаче.
          makeList([makeOrder({ customerName: `Клиент страницы ${page}` })], {
            page,
            pageSize: 1,
            total: 60,
            totalPages: 60,
          }),
        );
      }),
    );

    const { user } = render();
    expect(await screen.findByText('Клиент страницы 1')).toBeInTheDocument();
    expect(screen.getByText(/Показаны 1–1 из 60/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Вперёд' }));

    expect(await screen.findByText('Клиент страницы 2')).toBeInTheDocument();
    await waitFor(() => expect(currentSearch()).toContain('page=2'));
  });

  it('не показывает пагинацию, когда заказов нет', async () => {
    server.use(http.get(`${API}/orders`, () => HttpResponse.json(makeList([]))));

    render();
    await screen.findByText('Заказов пока нет');

    expect(screen.queryByRole('navigation', { name: 'Постраничная навигация' })).not.toBeInTheDocument();
  });
});
