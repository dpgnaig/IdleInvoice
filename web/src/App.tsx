import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { SetupGateContext } from '@/lib/setup-gate';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/layout/app-shell';
import LoginPage from '@/pages/login';
import RegisterPage from '@/pages/register';
import SetupPage from '@/pages/setup';
import DashboardPage from '@/pages/dashboard';
import CustomersPage from '@/pages/customers';
import ProductsPage from '@/pages/products';
import QuoteImportPage from '@/pages/quote-import';
import QuotesPage from '@/pages/quotes';
import QuoteDetailPage from '@/pages/quote-detail';
import InvoicesPage from '@/pages/invoices';
import InvoiceDetailPage from '@/pages/invoice-detail';
import AdminPage from '@/pages/admin';

function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="sr-only">Đang tải…</span>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Khi hệ thống chưa thiết lập, mọi trang chuyển về /setup. */
function SetupGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<'checking' | 'needed' | 'done'>('checking');
  useEffect(() => {
    api
      .get<{ setupCompleted: boolean }>(endpoints.setup.status)
      .then((r) => setState(r.data.setupCompleted ? 'done' : 'needed'))
      // /setup/* trả 403 sau khi hoàn tất => coi như đã thiết lập
      .catch(() => setState('done'));
  }, []);
  const markDone = useCallback(() => setState('done'), []);
  if (state === 'checking') return <FullPageLoader />;
  if (state === 'needed' && location.pathname !== '/setup') return <Navigate to="/setup" replace />;
  return <SetupGateContext.Provider value={markDone}>{children}</SetupGateContext.Provider>;
}

export function AppRoutes() {
  return (
    <SetupGate>
      <InnerRoutes />
    </SetupGate>
  );
}

function InnerRoutes() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={loading ? <FullPageLoader /> : user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/register" element={loading ? <FullPageLoader /> : user ? <Navigate to="/" replace /> : <RegisterPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/quotes/import" element={<QuoteImportPage />} />
        <Route path="/quotes" element={<QuotesPage />} />
        <Route path="/quotes/:id" element={<QuoteDetailPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
