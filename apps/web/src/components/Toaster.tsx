import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const STYLES: Record<ToastKind, string> = {
  success: 'bg-ok-soft text-ok ring-emerald-200',
  error: 'bg-danger-soft text-danger ring-red-200',
  info: 'bg-accent-soft text-accent ring-blue-200',
};

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message: string) => show('success', message),
      error: (message: string) => show('error', message),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* aria-live: результат действия должен объявляться, а не только показываться. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-md px-4 py-3 text-sm shadow-lg ring-1 ring-inset ${STYLES[toast.kind]}`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast должен вызываться внутри ToastProvider');
  }
  return context;
}
