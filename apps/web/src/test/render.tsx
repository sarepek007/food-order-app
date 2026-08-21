import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { createQueryClient } from '@/app/queryClient';
import { ToastProvider } from '@/components/Toaster';

/** Открывает текущий адрес тестам: фильтры обязаны попадать в query string. */
function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location" hidden>
      {location.pathname}
      {location.search}
    </span>
  );
}

interface RenderOptions {
  /** Начальный адрес: фильтры списка живут в query string. */
  route?: string;
  /** Шаблон маршрута, если компонент читает параметры пути. */
  path?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', path }: RenderOptions = {},
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const queryClient = createQueryClient({ retry: false });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <LocationProbe />
          {path ? (
            <Routes>
              <Route path={path} element={ui} />
            </Routes>
          ) : (
            ui
          )}
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );

  return { ...result, user: userEvent.setup() };
}
