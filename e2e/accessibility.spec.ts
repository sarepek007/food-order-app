import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createOrder, freeCourier, openOrder } from './helpers';

/**
 * Автопроверка доступности.
 *
 * Дефект «сообщение об ошибке внутри <label>» нашёлся случайно — скринридер
 * читал подпись поля вместе с текстом ошибки. Такое должно ловиться
 * автоматически, а не везением.
 */
async function scan(page: Page, context?: string) {
  const builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
  ]);

  const results = await (context ? builder.include(context) : builder).analyze();

  // Полный список нарушений в сообщении: иначе по «expected 0 to be 2»
  // невозможно понять, что чинить.
  const summary = results.violations
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes[0]?.html ?? ''}`)
    .join('\n');

  expect(results.violations, summary).toEqual([]);
}

test.describe('Доступность', () => {
  test('список заказов', async ({ page }) => {
    await page.goto('/orders');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await scan(page);
  });

  test('список с активными фильтрами и пустым результатом', async ({ page }) => {
    await page.goto('/orders?q=такогоадресатотовсенет');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await scan(page);
  });

  test('карточка заказа', async ({ page, request }) => {
    const order = await createOrder(request);
    await openOrder(page, order.id);
    await scan(page);
  });

  test('диалог назначения курьера', async ({ page, request }) => {
    const order = await createOrder(request);
    await freeCourier(request);

    await openOrder(page, order.id);
    await page.getByRole('button', { name: 'Назначить курьера' }).click();
    await expect(page.getByRole('radio').first()).toBeVisible();

    await scan(page);
  });

  test('диалог отмены с ошибкой валидации', async ({ page, request }) => {
    const order = await createOrder(request);
    await openOrder(page, order.id);

    await page.getByRole('button', { name: 'Отменить заказ' }).click();
    // Ошибка под полем — тот самый случай, который раньше ломал доступное имя.
    await page.getByRole('button', { name: 'Отменить заказ' }).last().click();
    await expect(page.getByText('Укажите причину отмены')).toBeVisible();

    await scan(page);
  });
});
