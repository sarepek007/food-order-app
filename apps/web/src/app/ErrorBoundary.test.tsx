import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ explode }: { explode: boolean }) {
  if (explode) {
    throw new Error('компонент упал');
  }
  return <p>всё в порядке</p>;
}

/** Управляет падением извне: после сброса границы дерево должно ожить. */
function Harness() {
  const [explode, setExplode] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setExplode(false)}>
        починить
      </button>
      <ErrorBoundary>
        <Boom explode={explode} />
      </ErrorBoundary>
    </>
  );
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React логирует пойманную ошибку — в выводе теста это шум.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('показывает содержимое, пока ошибок нет', () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('всё в порядке')).toBeInTheDocument();
  });

  it('перехватывает ошибку рендера вместо белого экрана', () => {
    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
    expect(screen.getByText('компонент упал')).toBeInTheDocument();
  });

  it('предлагает повторить и перезагрузить страницу', () => {
    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перезагрузить страницу' })).toBeInTheDocument();
  });

  it('после сброса показывает восстановленное содержимое', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'починить' }));
    await user.click(screen.getByRole('button', { name: 'Попробовать снова' }));

    expect(screen.getByText('всё в порядке')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
