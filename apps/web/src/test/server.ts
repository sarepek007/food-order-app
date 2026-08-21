import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { COURIER_FREE, COURIER_FULL, RESTAURANT, makeAudit, makeList, makeOrder } from './fixtures';

export const API = '*/api/v1';

/** Обработчики по умолчанию: «всё хорошо». Каждый тест переопределяет нужное. */
export const defaultHandlers = [
  http.get(`${API}/orders`, () => HttpResponse.json(makeList([makeOrder()]))),
  http.get(`${API}/orders/:id`, () =>
    HttpResponse.json(makeOrder(), { headers: { ETag: '"1"' } }),
  ),
  http.get(`${API}/orders/:id/audit`, () =>
    HttpResponse.json({
      items: makeAudit([{ action: 'ORDER_CREATED', oldStatus: null, newStatus: 'new' }]),
      page: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    }),
  ),
  http.get(`${API}/restaurants`, () => HttpResponse.json([RESTAURANT])),
  http.get(`${API}/couriers`, () => HttpResponse.json([COURIER_FREE, COURIER_FULL])),
];

export const server = setupServer(...defaultHandlers);
