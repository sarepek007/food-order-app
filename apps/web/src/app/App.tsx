import { Navigate, Route, Routes } from 'react-router';
import { EmptyState } from '@/components/states';
import { OrderPage } from '@/features/orders/OrderPage';
import { OrdersPage } from '@/features/orders/OrdersPage';
import { AppShell } from './AppShell';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/orders" replace />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:id" element={<OrderPage />} />
        <Route
          path="*"
          element={<EmptyState title="Страница не найдена" description="Проверьте адрес." />}
        />
      </Routes>
    </AppShell>
  );
}
