import type { APIRequestContext, Page } from '@playwright/test';

const API_PREFIX = '/api/v1';

export interface CreatedOrder {
  id: string;
  publicNumber: number;
  version: number;
}

/**
 * Каждый сценарий работает со своим заказом, созданным через API.
 * Так тесты не зависят от порядка запуска и не портят данные друг другу.
 */
export async function createOrder(
  request: APIRequestContext,
  overrides: { deliveryAddress?: string; customerName?: string } = {},
): Promise<CreatedOrder> {
  const restaurants = await request.get(`${API_PREFIX}/restaurants`);
  const [restaurant] = await restaurants.json();

  const response = await request.post(`${API_PREFIX}/orders`, {
    headers: { 'X-Actor': encodeURIComponent('e2e') },
    data: {
      customerName: overrides.customerName ?? `E2E Клиент ${Date.now()}`,
      restaurantId: restaurant.id,
      deliveryAddress: overrides.deliveryAddress ?? 'Ленинский проспект, д. 12, кв. 45',
      totalAmount: '1234.50',
    },
  });

  if (!response.ok()) {
    throw new Error(`Не удалось создать заказ: ${response.status()} ${await response.text()}`);
  }

  return response.json();
}

/** Первый курьер со свободным слотом — иначе назначение упрётся в лимит. */
export async function freeCourier(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const response = await request.get(`${API_PREFIX}/couriers`);
  const couriers = await response.json();
  const courier = couriers.find((item: { hasCapacity: boolean; isActive: boolean }) => item.hasCapacity && item.isActive);

  if (!courier) {
    throw new Error('Нет курьера со свободным слотом');
  }
  return courier;
}

/** Изменение заказа «другим оператором» — для сценария конкурентного доступа. */
export async function assignCourierViaApi(
  request: APIRequestContext,
  orderId: string,
  courierId: string,
  version: number,
  actor: string,
): Promise<void> {
  const response = await request.put(`${API_PREFIX}/orders/${orderId}/courier`, {
    headers: { 'If-Match': `"${version}"`, 'X-Actor': encodeURIComponent(actor) },
    data: { courierId },
  });

  if (!response.ok()) {
    throw new Error(`Назначение курьера не прошло: ${response.status()} ${await response.text()}`);
  }
}

export async function openOrder(page: Page, orderId: string): Promise<void> {
  await page.goto(`/orders/${orderId}`);
  await page.getByText(/Заказ №/).waitFor();
}
