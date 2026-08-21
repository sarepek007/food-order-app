import { expect, test } from '@playwright/test';
import { createOrder } from './helpers';

test.describe('Список заказов', () => {
  test('фильтрует, ищет по адресу и открывает карточку', async ({ page, request }) => {
    const marker = `E2E Поиск ${Date.now()}`;
    const order = await createOrder(request, {
      customerName: marker,
      deliveryAddress: 'Ленинский проспект, д. 12, кв. 45',
    });

    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Заказы' })).toBeVisible();

    // Фильтр по статусу попадает в адресную строку.
    await page.getByRole('button', { name: 'Новый', exact: true }).click();
    await expect(page).toHaveURL(/status=new/);

    // Поиск с опечаткой находит заказ: «Лениский проспкт» вместо «Ленинский проспект».
    await page.getByLabel('Поиск по адресу').fill('Лениский проспкт 12');
    await expect(page).toHaveURL(/q=/);
    await expect(page.getByRole('link', { name: `Открыть заказ №${order.publicNumber}` })).toBeVisible();

    await page.getByRole('link', { name: `Открыть заказ №${order.publicNumber}` }).click();

    await expect(page).toHaveURL(new RegExp(`/orders/${order.id}`));
    await expect(page.getByRole('heading', { name: `Заказ №${order.publicNumber}` })).toBeVisible();
    await expect(page.getByText(marker)).toBeVisible();
  });

  test('состояние фильтров переживает перезагрузку страницы', async ({ page }) => {
    await page.goto('/orders?status=delivered&sort=totalAmount&order=asc');

    await expect(page.getByRole('button', { name: 'Доставлен' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.reload();

    await expect(page.getByRole('button', { name: 'Доставлен' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('columnheader', { name: /Сумма/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  test('отбирает просроченные заказы и сортирует по времени в статусе', async ({ page }) => {
    await page.goto('/orders');

    await page.getByRole('button', { name: /Только просроченные/ }).click();
    await expect(page).toHaveURL(/overdue=true/);

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Все показанные заказы отмечены как просроченные — признак объявлен
    // текстом, а не только цветом строки.
    const total = await rows.count();
    await expect(page.getByText('— просрочен')).toHaveCount(total);

    await page.getByRole('button', { name: /В статусе/ }).click();
    await expect(page).toHaveURL(/sort=timeInStatus/);
  });

  test('показывает пустое состояние и позволяет сбросить фильтры', async ({ page }) => {
    await page.goto('/orders?q=такогоадресатотовсенет');

    await expect(page.getByText('Ничего не найдено')).toBeVisible();

    await page.getByRole('button', { name: 'Сбросить фильтры' }).first().click();

    await expect(page.getByText('Ничего не найдено')).toBeHidden();
    await expect(page).not.toHaveURL(/q=/);
  });
});
