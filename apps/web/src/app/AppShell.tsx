import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { DEFAULT_ACTOR, getActor, setActor } from '@/api/client';
import { CourierIcon } from '@/components/icons';

/**
 * Аутентификации нет, но журнал изменений должен знать автора.
 * Имя оператора вводится один раз и хранится локально.
 */
function ActorField() {
  const [value, setValue] = useState(getActor());

  return (
    <label className="flex items-center gap-2 rounded-lg bg-surface-muted px-2.5 py-1.5 ring-1 ring-line">
      <CourierIcon className="size-4 text-muted" />
      <span className="sr-only">Имя оператора</span>
      <input
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setActor(event.target.value);
        }}
        placeholder={DEFAULT_ACTOR}
        aria-label="Имя оператора"
        className="w-32 bg-transparent text-sm text-ink outline-none placeholder:text-faint sm:w-40"
      />
    </label>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-[110rem] items-center gap-3 px-4 py-2.5 sm:gap-6 sm:px-6">
          <NavLink to="/orders" className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white"
            >
              З
            </span>
            <span className="hidden text-sm font-semibold sm:inline">Операционная консоль</span>
          </NavLink>

          <nav className="flex gap-1 text-sm">
            <NavLink
              to="/orders"
              className={({ isActive }) =>
                `rounded-lg px-2.5 py-1.5 transition-colors ${
                  isActive ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-ink'
                }`
              }
            >
              Заказы
            </NavLink>
          </nav>

          <div className="ml-auto">
            <ActorField />
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
