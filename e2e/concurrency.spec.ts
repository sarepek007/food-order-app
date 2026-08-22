import { expect, test } from '@playwright/test';
import {
  assignCourierViaApi,
  createOrder,
  disableOrderStream,
  freeCourier,
  openOrder,
} from './helpers';

test.describe('Конкурентное изменение заказа', () => {
  test('изменение второго оператора не перезаписывается молча', async ({ page, request }) => {
    const order = await createOrder(request);
    const courier = await freeCourier(request);

    await disableOrderStream(page);

    // Оператор A открыл заказ и видит версию 1.
    await openOrder(page, order.id);
    await expect(page.getByText('версия 1')).toBeVisible();

    // Оператор B в это время назначает курьера.
    await assignCourierViaApi(request, order.id, courier.id, order.version, 'Оператор B');

    // Оператор A действует на устаревшем состоянии.
    await page.getByRole('button', { name: 'Перевести в «Принят»' }).click();

    const banner = page.getByTestId('conflict-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByText('Заказ изменён другим пользователем')).toBeVisible();
    await expect(banner.getByText(`назначен курьер ${courier.name}`)).toBeVisible();
    await expect(banner.getByText(/Ваша версия — 1, актуальная — 2/)).toBeVisible();
    await expect(banner.getByText(/перевод в статус «Принят» — не применено/)).toBeVisible();

    // Изменение оператора B сохранилось.
    await expect(page.getByTestId('order-courier')).toContainText(courier.name);
  });

  test('оператор может применить своё изменение поверх', async ({ page, request }) => {
    const order = await createOrder(request);
    const courier = await freeCourier(request);

    await disableOrderStream(page);
    await openOrder(page, order.id);
    await assignCourierViaApi(request, order.id, courier.id, order.version, 'Оператор B');

    await page.getByRole('button', { name: 'Перевести в «Принят»' }).click();
    await expect(page.getByTestId('conflict-banner')).toBeVisible();

    await page.getByRole('button', { name: 'Применить моё изменение поверх' }).click();

    await expect(page.getByText('Изменение сохранено')).toBeVisible();
    await expect(page.getByTestId('conflict-banner')).toBeHidden();
    await expect(page.getByTestId('order-status')).toHaveText('Принят');
    // Обе правки на месте: и чужая, и своя.
    await expect(page.getByTestId('order-courier')).toContainText(courier.name);
  });

  test('две вкладки: вторая получает конфликт вместо перезаписи', async ({ browser, request }) => {
    const order = await createOrder(request);
    const courier = await freeCourier(request);

    const contextA = await browser.newContext({ locale: 'ru-RU' });
    const contextB = await browser.newContext({ locale: 'ru-RU' });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // У вкладки A поток недоступен — она остаётся с устаревшим состоянием.
      await disableOrderStream(pageA);
      await openOrder(pageA, order.id);
      await openOrder(pageB, order.id);

      // B назначает курьера через интерфейс.
      await pageB.getByRole('button', { name: 'Назначить курьера' }).click();
      await pageB.getByRole('radio', { name: new RegExp(courier.name) }).click();
      await pageB.getByRole('button', { name: 'Назначить', exact: true }).click();
      await expect(pageB.getByText('Изменение сохранено')).toBeVisible();

      // A всё ещё держит старое состояние.
      await pageA.getByRole('button', { name: 'Перевести в «Принят»' }).click();
      await expect(pageA.getByTestId('conflict-banner')).toBeVisible();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('открытая карточка узнаёт о чужом изменении без перезагрузки', async ({ page, request }) => {
    const order = await createOrder(request);
    const courier = await freeCourier(request);

    await openOrder(page, order.id);
    await expect(page.getByText('версия 1')).toBeVisible();

    // Изменение приходит извне — страницу никто не перезагружает.
    await assignCourierViaApi(request, order.id, courier.id, order.version, 'Оператор B');

    const notice = page.getByTestId('live-change-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Оператор B');

    // Данные подтянулись сами: следующее действие не упрётся в конфликт.
    await expect(page.getByTestId('order-courier')).toContainText(courier.name);
    await expect(page.getByText('версия 2')).toBeVisible();

    await page.getByRole('button', { name: 'Перевести в «Принят»' }).click();
    await expect(page.getByText('Изменение сохранено')).toBeVisible();
    await expect(page.getByTestId('conflict-banner')).toBeHidden();
  });

  test('список обновляется без участия оператора', async ({ page, request }) => {
    await page.goto('/orders?status=new&sort=createdAt&order=desc');
    await expect(page.locator('tbody tr').first()).toBeVisible();

    const marker = `E2E Поток ${Date.now()}`;
    await createOrder(request, { customerName: marker });

    // Ни клика, ни перезагрузки — новая строка приезжает сама.
    await expect(page.getByText(marker)).toBeVisible({ timeout: 10_000 });
  });

  test('лимит активных доставок виден до попытки назначения', async ({ page, request }) => {
    const order = await createOrder(request);
    await openOrder(page, order.id);

    const couriers = await (await request.get('/api/v1/couriers')).json();
    const full = couriers.find((item: { hasCapacity: boolean }) => !item.hasCapacity);
    test.skip(!full, 'В данных нет курьера с заполненным лимитом');

    await page.getByRole('button', { name: 'Назначить курьера' }).click();
    await expect(page.getByRole('radio', { name: new RegExp(full.name) })).toBeDisabled();
  });
});
