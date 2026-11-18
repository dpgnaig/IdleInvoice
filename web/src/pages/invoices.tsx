import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Download, FileText, Loader2, Search } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { DataTable, type Column, type SortState } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Pagination } from './customers';
import { formatDate, formatMoney } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface InvoiceRow {
  id: number;
  customerName: string;
  customerTaxCode: string;
  status: 'draft' | 'exported';
  paymentMethod: string;
  createdAt: string;
  lineCount: number;
  subtotal: number;
}

export default function InvoicesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | 'draft' | 'exported'>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const [sort, setSort] = useState<SortState | null>({ key: 'createdAt', dir: 'desc' });

  const list = useQuery({
    queryKey: ['invoices', status, page],
    queryFn: async () => {
      const { data } = await api.get('/invoices', {
        params: { status: status || undefined, page, pageSize: 20 },
      });
      return data as { data: InvoiceRow[]; pagination: { page: number; totalPages: number; total: number } };
    },
  });

  const rows = useMemo(() => {
    const filtered = (list.data?.data ?? []).filter(
      (r) =>
        !search ||
        r.customerName.toLowerCase().includes(search.toLowerCase()) ||
        r.customerTaxCode.includes(search),
    );
    if (!sort) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'id':
          return (a.id - b.id) * dir;
        case 'customer':
          return a.customerName.localeCompare(b.customerName, 'vi') * dir;
        case 'subtotal':
          return (a.subtotal - b.subtotal) * dir;
        case 'status':
          return a.status.localeCompare(b.status) * dir;
        case 'createdAt':
        default:
          return a.createdAt.localeCompare(b.createdAt) * dir;
      }
    });
  }, [list.data?.data, search, sort]);

  const columns = useMemo<Column<InvoiceRow>[]>(
    () => [
      {
        key: 'id',
        header: '#',
        sortKey: 'id',
        render: (r) => (
          <Link to={`/invoices/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
            #{r.id}
          </Link>
        ),
      },
      {
        key: 'customer',
        header: 'Khách hàng',
        sortKey: 'customer',
        render: (r) => (
          <Link to={`/invoices/${r.id}`} className="block">
            <p className="font-medium hover:underline">{r.customerName}</p>
            <p className="text-xs text-muted-foreground">MST {r.customerTaxCode}</p>
          </Link>
        ),
      },
      { key: 'lines', header: 'Số dòng', align: 'right', render: (r) => r.lineCount },
      { key: 'subtotal', header: 'Tiền hàng', align: 'right', sortKey: 'subtotal', render: (r) => formatMoney(r.subtotal) },
      { key: 'payment', header: 'Thanh toán', render: (r) => r.paymentMethod },
      { key: 'createdAt', header: 'Ngày tạo', sortKey: 'createdAt', render: (r) => formatDate(r.createdAt) },
      {
        key: 'status',
        header: 'Trạng thái',
        sortKey: 'status',
        render: (r) => (
          <span
            className={cn(
              'badge',
              r.status === 'draft'
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
            )}
          >
            {r.status === 'draft' ? 'Nháp' : 'Đã xuất'}
          </span>
        ),
      },
    ],
    [],
  );

  const exportExcel = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await api.post('/invoices/export', { ids }, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mau_hd_export.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast.success('Đã xuất file Excel');
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggle = (k: string | number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const idsToExport = Array.from(selected).map(Number);

  return (
    <div>
      <PageHeader
        title="Hóa đơn"
        description="Hóa đơn nháp tạo từ báo giá. Chọn các hóa đơn rồi xuất Excel để import lên phần mềm hóa đơn."
        actions={
          <button
            className="btn-primary"
            disabled={idsToExport.length === 0 || exportExcel.isPending}
            onClick={() => void exportExcel.mutateAsync(idsToExport)}
          >
            {exportExcel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Xuất Excel ({idsToExport.length})
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border p-0.5" role="tablist" aria-label="Lọc trạng thái">
          {[
            { v: '', label: 'Tất cả' },
            { v: 'draft', label: 'Nháp' },
            { v: 'exported', label: 'Đã xuất' },
          ].map((t) => (
            <button
              key={t.v}
              role="tab"
              aria-selected={status === t.v}
              onClick={() => { setStatus(t.v as typeof status); setPage(1); }}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                status === t.v ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Lọc theo khách hàng…"
            aria-label="Lọc hóa đơn theo khách hàng"
            className="input h-9 pl-8"
          />
        </div>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        selected={selected}
        onToggle={toggle}
        onToggleAll={() =>
          setSelected((s) => (rows.every((r) => s.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id))))
        }
        loading={list.isLoading}
        sort={sort}
        onSortChange={setSort}
        columnToggle
        storageKey="invoices"
        empty={
          <EmptyState
            illustration={<FileText className="h-10 w-10 text-muted-foreground" />}
            title="Chưa có hóa đơn"
            description="Vào mục Nhập báo giá để tạo hóa đơn nháp từ báo giá của khách hàng."
          />
        }
      />

      {list.data && list.data.pagination.totalPages > 1 && (
        <Pagination page={page} totalPages={list.data.pagination.totalPages} onChange={setPage} />
      )}
    </div>
  );
}
