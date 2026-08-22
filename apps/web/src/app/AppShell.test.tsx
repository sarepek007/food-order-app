import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ACTOR, getActor, setActor } from '@/api/client';
import { AppShell } from './AppShell';

function renderShell() {
  return render(
    <MemoryRouter>
      <AppShell>
        <p>содержимое страницы</p>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  beforeEach(() => {
    setActor(DEFAULT_ACTOR);
  });

  it('показывает содержимое и навигацию', () => {
    renderShell();

    expect(screen.getByText('содержимое страницы')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Заказы' })).toHaveAttribute('href', '/orders');
  });

  it('сохраняет имя оператора: журнал должен знать автора', async () => {
    const user = userEvent.setup();
    renderShell();

    const field = screen.getByLabelText('Имя оператора');
    await user.clear(field);
    await user.type(field, 'Анна Петрова');

    expect(getActor()).toBe('Анна Петрова');
  });

  it('пустое имя откатывается к значению по умолчанию', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.clear(screen.getByLabelText('Имя оператора'));

    expect(getActor()).toBe(DEFAULT_ACTOR);
  });
});
