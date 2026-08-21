import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/Button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Последний рубеж: ошибка рендера не должна оставлять оператора
 * перед пустым белым экраном.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Ошибка рендера', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div role="alert" className="mx-auto max-w-lg p-10 text-center">
        <h1 className="text-lg font-semibold text-danger">Что-то пошло не так</h1>
        <p className="mt-2 text-sm text-muted">{this.state.error.message}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            Попробовать снова
          </Button>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Перезагрузить страницу
          </Button>
        </div>
      </div>
    );
  }
}
