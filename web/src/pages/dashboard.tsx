import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText, History, Package, Upload, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatCard } from '@/components/layout/page-header';
import { CountUpMoney } from '@/components/ui/count-up';
import { formatMoney } from '@/lib/utils';

export default function DashboardPage() {
  const customers = useQuery({
    queryKey: ['dash-customers'],
    queryFn: async () => (await api.get('/customers', { params: { pageSize: 1 } })).data.pagination.total as number,
  });
  const products = useQuery({
    queryKey: ['dash-products'],
    queryFn: async () => (await api.get('/products', { params: { pageSize: 1 } })).data.pagination.total as number,
  });
  const invoices = useQuery({
    queryKey: ['dash-invoices'],
    queryFn: async () => (await api.get('/invoices', { params: { pageSize: 200 } })).data as {
      data: Array<{ id: number; status: string; subtotal: number; customerName: string }>;
      pagination: { total: number };
    },
  });
  const quotes = useQuery({
    queryKey: ['dash-quotes'],
    queryFn: async () => (await api.get('/quotes', { params: { pageSize: 5 } })).data as {
      data: Array<{ id: number; quoteNo: string; createdAt: string; customerName: string }>;
      pagination: { total: number };
    },
  });

  const draftTotal = (invoices.data?.data ?? [])
    .filter((i) => i.status === 'draft')
    .reduce((s, i) => s + (i.subtotal ?? 0), 0);
  const draftCount = (invoices.data?.data ?? []).filter((i) => i.status === 'draft').length;

  return (
    <div>
      <PageHeader
        title="Tổng quan"
        description="Tình hình báo giá và hóa đơn trong hệ thống."
        actions={
          <Link to="/quotes/import" className="btn-primary">
            <Upload className="h-4 w-4" /> Nhập báo giá
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Khách hàng" value={customers.data ?? '—'} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Hàng hóa" value={products.data ?? '—'} icon={<Package className="h-4 w-4" />} />
        <StatCard label="Báo giá đã đọc" value={quotes.data?.pagination.total ?? '—'} icon={<History className="h-4 w-4" />} />
        <StatCard
          label="Hóa đơn nháp"
          value={invoices.data?.pagination.total ?? '—'}
          hint={`Tiền hàng nháp: ${formatMoney(draftTotal)}`}
          icon={<FileText className="h-4 w-4" />}
          accent
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card-surface p-5">
          <h2 className="text-sm font-semibold">Hóa đơn nháp gần đây</h2>
          {(invoices.data?.data ?? []).slice(0, 6).map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b py-2.5 last:border-0 text-sm">
              <span className="truncate">{i.customerName}</span>
              <span className="tabular-nums text-muted-foreground">{formatMoney(i.subtotal)}</span>
            </div>
          ))}
          {draftCount === 0 && <p className="py-6 text-sm text-muted-foreground">Chưa có hóa đơn nháp.</p>}
          <Link to="/invoices" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
            Xem tất cả hóa đơn
          </Link>
        </div>

        <div className="card-surface p-5">
          <h2 className="text-sm font-semibold">Báo giá gần đây</h2>
          {(quotes.data?.data ?? []).map((q) => (
            <div key={q.id} className="flex items-center justify-between border-b py-2.5 last:border-0 text-sm">
              <span className="truncate font-mono text-xs">{q.quoteNo}</span>
              <span className="truncate text-muted-foreground">{q.customerName}</span>
            </div>
          ))}
          {(quotes.data?.data ?? []).length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">Chưa đọc báo giá nào.</p>
          )}
          <Link to="/quotes" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
            Lịch sử báo giá
          </Link>
        </div>
      </div>

      {draftTotal > 0 && (
        <div className="card-surface mt-4 flex items-center justify-between p-5">
          <span className="text-sm text-muted-foreground">Tổng tiền hàng đang chờ xuất</span>
          <CountUpMoney value={draftTotal} className="text-xl font-semibold text-primary" />
        </div>
      )}
    </div>
  );
}
