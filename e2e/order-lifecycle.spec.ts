import { expect, test } from '@playwright/test';
import { createOrder, freeCourier, openOrder } from './helpers';

test.describe('Жизненный цикл заказа', () => {
  test('проводит заказ по статусам и пишет каждый шаг в журнал', async ({ page, request }) => {
    const order = await createOrder(request);
    const courier = await freeCourier(request);

    await openOrder(page, order.id);
    await expect(page.getByTestId('order-status')).toHaveText('Новый');

    // Недопустимых переходов в интерфейсе нет — только следующий по конвейеру.
    await expect(page.getByRole('button', { name: 'Перевести в «Доставлен»' })).toBeHidden();

    await page.getByRole('button', { name: 'Перевести в «Принят»' }).click();
    await expect(page.getByText('Изменение сохранено')).toBeVisible();
    await expect(page.getByText('версия 2')).toBeVisible();

    await page.getByRole('button', { name: 'Перевести в «Готовится»' }).click();
    await expect(page.getByText('версия 3')).toBeVisible();

    await page.getByRole('button', { name: 'Назначить курьера' }).click();
    await page.getByRole('radio', { name: new RegExp(courier.name) }).click();
    await page.getByRole('button', { name: 'Назначить', exact: true }).click();

    await expect(page.getByTestId('order-courier')).toContainText(courier.name);

    // Журнал содержит всю историю в обратном хронологическом порядке.
    const history = page.locator('section', { hasText: 'История изменений' });
    await expect(history.getByText('Курьер назначен', { exact: false })).toBeVisible();
    await expect(history.getByText('Новый → Принят')).toBeVisible();
    await expect(history.getByText('Принят → Готовится')).toBeVisible();
    await expect(history.getByText('Заказ создан')).toBeVisible();
  });

  test('отменяет заказ с обязательной причиной', async ({ page, request }) => {
    const order = await createOrder(request);
    await openOrder(page, order.id);

    await page.getByRole('button', { name: 'Отменить заказ' }).click();

    // Пустая причина не отправляется.
    await page.getByRole('button', { name: 'Отменить заказ' }).last().click();
    await expect(page.getByText('Укажите причину отмены')).toBeVisible();

    await page.getByLabel('Причина отмены').fill('клиент передумал');
    await page.getByRole('button', { name: 'Отменить заказ' }).last().click();

    await expect(page.getByText('Изменение сохранено')).toBeVisible();
    await expect(page.getByTestId('order-status')).toHaveText('Отменён');
    await expect(page.getByText('клиент передумал').first()).toBeVisible();
    // Терминальный статус — действий больше нет.
    await expect(page.getByText(/терминальном статусе/)).toBeVisible();
  });

  test('запрещает отмену после передачи курьеру', async ({ page, request }) => {
    const order = await createOrder(request);
    const courier = await freeCourier(request);

    await openOrder(page, order.id);
    await page.getByRole('button', { name: 'Перевести в «Принят»' }).click();
    await expect(page.getByText('версия 2')).toBeVisible();
    await page.getByRole('button', { name: 'Перевести в «Готовится»' }).click();
    await expect(page.getByText('версия 3')).toBeVisible();

    await page.getByRole('button', { name: 'Назначить курьера' }).click();
    await page.getByRole('radio', { name: new RegExp(courier.name) }).click();
    await page.getByRole('button', { name: 'Назначить', exact: true }).click();
    await expect(page.getByText('версия 4')).toBeVisible();

    await page.getByRole('button', { name: 'Перевести в «Готов к выдаче»' }).click();
    await expect(page.getByText('версия 5')).toBeVisible();
    // В ready отмена ещё доступна.
    await expect(page.getByRole('button', { name: 'Отменить заказ' })).toBeVisible();

    await page.getByRole('button', { name: 'Перевести в «Забран курьером»' }).click();
    await expect(page.getByText('версия 6')).toBeVisible();

    // После picked_up — уже нет: граница из ТЗ.
    await expect(page.getByRole('button', { name: 'Отменить заказ' })).toBeHidden();
  });
});
