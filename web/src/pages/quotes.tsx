import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { History, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Pagination } from '@/components/ui/pagination';
import { useAutoPageSize } from '@/lib/use-auto-page-size';
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
  const { ref: tableRef, pageSize } = useAutoPageSize();
  // Số dòng/trang đổi theo kích thước cửa sổ -> quay về trang 1 để không vượt quá số trang
  useEffect(() => setPage(1), [pageSize]);
  const [toDelete, setToDelete] = useState<QuoteRow | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ['quotes', page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get('/quotes', { params: { page, pageSize } });
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
    { key: 'quoteNo', width: '200px', header: 'Số báo giá', render: (r) => <span className="font-mono text-xs">{r.quoteNo}</span> },
    { key: 'quoteDate', width: '130px', header: 'Ngày báo giá', render: (r) => formatDate(r.quoteDate) },
    { key: 'customer', header: 'Khách hàng', render: (r) => r.customerName || '—' },
    { key: 'total', width: '160px', header: 'Tổng khai báo', align: 'right', render: (r) => formatMoney(r.declaredTotal) },
    { key: 'createdAt', width: '130px', header: 'Đã đọc lúc', render: (r) => formatDate(r.createdAt) },
    {
      key: 'status', width: '110px',
      header: 'Hóa đơn',
      render: (r) => (r.invoiceStatus === 'exported' ? 'Đã xuất' : r.invoiceStatus ? 'Nháp' : '—'),
    },
    {
      key: 'actions', width: '140px',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/quotes/${r.id}`);
            }}
          >
            Chi tiết
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Xóa báo giá ${r.quoteNo}`}
            disabled={r.invoiceStatus === 'exported'}
            title={r.invoiceStatus === 'exported' ? 'Hóa đơn đã xuất — không thể xóa' : 'Xóa báo giá'}
            onClick={(e) => {
              e.stopPropagation();
              setToDelete(r);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Lịch sử báo giá" description="Các báo giá đã đọc và lưu trong hệ thống." />
      <DataTable
        cardRef={tableRef}
        footer={
          <Pagination
            page={page}
            totalPages={list.data?.pagination.totalPages ?? 1}
            total={list.data?.pagination.total}
            pageSize={pageSize}
            unit="báo giá"
            onChange={setPage}
          />
        }
        rows={list.data?.data ?? []}
        pageSize={pageSize}
        fetching={list.isPlaceholderData}
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
