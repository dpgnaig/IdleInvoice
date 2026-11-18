import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { History, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Pagination } from './customers';
import { formatDate, formatMoney } from '@/lib/utils';

interface QuoteRow {
  id: number;
  quoteNo: string;
  quoteDate: string | null;
  customerName: string;
  declaredTotal: number | null;
  createdAt: string;
  invoiceId: number | null;
  invoiceStatus: string | null;
}

export default function QuotesPage() {
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<QuoteRow | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ['quotes', page],
    queryFn: async () => {
      const { data } = await api.get('/quotes', { params: { page, pageSize: 20 } });
      return data as { data: QuoteRow[]; pagination: { totalPages: number; total: number } };
    },
  });

  const remove = useMutation({
    mutationFn: async (row: QuoteRow) => api.delete(`/quotes/${row.id}`),
    onSuccess: (_r, row) => {
      toast.success(`Đã xóa báo giá ${row.quoteNo}`);
      setToDelete(null);
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const columns: Column<QuoteRow>[] = [
    { key: 'quoteNo', header: 'Số báo giá', render: (r) => <span className="font-mono text-xs">{r.quoteNo}</span> },
    { key: 'quoteDate', header: 'Ngày báo giá', render: (r) => formatDate(r.quoteDate) },
    { key: 'customer', header: 'Khách hàng', render: (r) => r.customerName || '—' },
    { key: 'total', header: 'Tổng khai báo', align: 'right', render: (r) => formatMoney(r.declaredTotal) },
    { key: 'createdAt', header: 'Đã đọc lúc', render: (r) => formatDate(r.createdAt) },
    {
      key: 'status',
      header: 'Hóa đơn',
      render: (r) => (r.invoiceStatus === 'exported' ? 'Đã xuất' : r.invoiceStatus ? 'Nháp' : '—'),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <button
            className="btn-ghost h-8 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/quotes/${r.id}`);
            }}
          >
            Chi tiết
          </button>
          <button
            className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            aria-label={`Xóa báo giá ${r.quoteNo}`}
            disabled={r.invoiceStatus === 'exported'}
            title={r.invoiceStatus === 'exported' ? 'Hóa đơn đã xuất — không thể xóa' : 'Xóa báo giá'}
            onClick={(e) => {
              e.stopPropagation();
              setToDelete(r);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Lịch sử báo giá" description="Các báo giá đã đọc và lưu trong hệ thống." />
      <DataTable
        rows={list.data?.data ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        onRowClick={(r) => navigate(`/quotes/${r.id}`)}
        empty={
          <EmptyState
            illustration={<History className="h-10 w-10 text-muted-foreground" />}
            title="Chưa có báo giá"
            description="Báo giá sẽ xuất hiện ở đây sau khi bạn nhập và xác nhận."
          />
        }
      />
      {list.data && list.data.pagination.totalPages > 1 && (
        <Pagination page={page} totalPages={list.data.pagination.totalPages} onChange={setPage} />
      )}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Xóa báo giá?"
        description={
          toDelete
            ? `Báo giá "${toDelete.quoteNo}"${toDelete.invoiceStatus ? ' và hóa đơn nháp đi kèm' : ''} sẽ bị xóa. Không hoàn tác được.`
            : ''
        }
        confirmLabel="Xóa"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete);
        }}
      />
    </div>
  );
}
