import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText, History, Package, Upload, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { PageHeader, StatCard } from '@/components/layout/page-header';
import { CountUpMoney } from '@/components/ui/count-up';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/utils';

export default function DashboardPage() {
  const customers = useQuery({
    queryKey: ['dash-customers'],
    queryFn: async () => (await api.get(endpoints.customers.list, { params: { pageSize: 1 } })).data.pagination.total as number,
  });
  const products = useQuery({
    queryKey: ['dash-products'],
    queryFn: async () => (await api.get(endpoints.products.list, { params: { pageSize: 1 } })).data.pagination.total as number,
  });
  const invoices = useQuery({
    queryKey: ['dash-invoices'],
    queryFn: async () => (await api.get(endpoints.invoices.list, { params: { pageSize: 200 } })).data as {
      data: Array<{ id: number; status: string; subtotal: number; customerName: string }>;
      pagination: { total: number };
    },
  });
  const quotes = useQuery({
    queryKey: ['dash-quotes'],
    queryFn: async () => (await api.get(endpoints.quotes.list, { params: { pageSize: 5 } })).data as {
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
          <Button asChild>
            <Link to="/quotes/import">
              <Upload /> Nhập báo giá
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Khách hàng" value={customers.data ?? '—'} icon={<Users className="h-4 w-4" />} delay={0} />
        <StatCard label="Hàng hóa" value={products.data ?? '—'} icon={<Package className="h-4 w-4" />} delay={80} />
        <StatCard label="Báo giá đã đọc" value={quotes.data?.pagination.total ?? '—'} icon={<History className="h-4 w-4" />} delay={160} />
        <StatCard
          label="Hóa đơn nháp"
          value={invoices.data?.pagination.total ?? '—'}
          hint={`Tiền hàng nháp: ${formatMoney(draftTotal)}`}
          icon={<FileText className="h-4 w-4" />}
          accent
          delay={240}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="animate__animated animate__fadeIn" style={{ animationDelay: '360ms' }}>
          <CardHeader className="flex-col items-start gap-1 space-y-0 pb-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-sm">Hóa đơn nháp gần đây</CardTitle>
            <Button variant="link" size="sm" className="-ml-3 sm:ml-0" asChild>
              <Link to="/invoices">Xem tất cả hóa đơn</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {(invoices.data?.data ?? []).slice(0, 6).map((i) => (
              <div key={i.id} className="flex flex-col gap-0.5 border-b py-2.5 text-sm last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="min-w-0 truncate">{i.customerName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(i.subtotal)}</span>
              </div>
            ))}
            {draftCount === 0 && <p className="py-6 text-sm text-muted-foreground">Chưa có hóa đơn nháp.</p>}
          </CardContent>
        </Card>

        <Card className="animate__animated animate__fadeIn" style={{ animationDelay: '440ms' }}>
          <CardHeader className="flex-col items-start gap-1 space-y-0 pb-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-sm">Báo giá gần đây</CardTitle>
            <Button variant="link" size="sm" className="-ml-3 sm:ml-0" asChild>
              <Link to="/quotes">Lịch sử báo giá</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {(quotes.data?.data ?? []).map((q) => (
              <div key={q.id} className="flex flex-col gap-0.5 border-b py-2.5 text-sm last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="min-w-0 truncate font-mono text-xs">{q.quoteNo}</span>
                <span className="min-w-0 truncate text-muted-foreground">{q.customerName}</span>
              </div>
            ))}
            {(quotes.data?.data ?? []).length === 0 && (
              <p className="py-6 text-sm text-muted-foreground">Chưa đọc báo giá nào.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {draftTotal > 0 && (
        <Card className="mt-4 flex items-center justify-between p-5">
          <span className="text-sm text-muted-foreground">Tổng tiền hàng đang chờ xuất</span>
          <CountUpMoney value={draftTotal} className="text-xl font-semibold text-primary" />
        </Card>
      )}
    </div>
  );
}
