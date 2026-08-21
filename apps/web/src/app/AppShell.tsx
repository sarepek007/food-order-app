import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { DEFAULT_ACTOR, getActor, setActor } from '@/api/client';

/**
 * Аутентификации нет, но журнал изменений должен знать автора.
 * Имя оператора вводится один раз и хранится локально.
 */
function ActorField() {
  const [value, setValue] = useState(getActor());

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Оператор
      <input
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setActor(event.target.value);
        }}
        placeholder={DEFAULT_ACTOR}
        aria-label="Имя оператора"
        className="w-40 rounded-md bg-surface px-2 py-1 text-sm text-ink ring-1 ring-line"
      />
    </label>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[110rem] items-center gap-6 px-6 py-3">
          <NavLink to="/orders" className="text-sm font-semibold">
            Операционная консоль
          </NavLink>
          <nav className="flex gap-4 text-sm">
            <NavLink
              to="/orders"
              className={({ isActive }) => (isActive ? 'text-accent' : 'text-muted hover:text-ink')}
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
