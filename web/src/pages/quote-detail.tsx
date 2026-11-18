import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, FileText, Loader2, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/empty-state';
import { formatDate, formatMoney, formatTaxRate } from '@/lib/utils';

interface QuoteDetail {
  quote: {
    id: number;
    quoteNo: string;
    quoteDate: string | null;
    declaredSubtotal: number | null;
    declaredVat: number | null;
    declaredTotal: number | null;
    note: string;
    createdAt: string;
  };
  customer: { id: number; name: string; taxCode: string; address: string; email: string } | null;
  file: { originalName: string; parseStatus: string } | null;
  invoice: { id: number; status: 'draft' | 'exported'; total: number } | null;
  lines: Array<{
    id: number;
    productId: number;
    qty: number;
    unitPrice: number;
    taxRate: number;
    code: string;
    name: string;
    unit: string;
  }>;
}

export default function QuoteDetailPage() {
  const { id } = useParams();
  const quoteId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: async () => (await api.get<QuoteDetail>(`/quotes/${quoteId}`)).data,
  });

  const remove = useMutation({
    mutationFn: async () => api.delete(`/quotes/${quoteId}`),
    onSuccess: () => {
      toast.success('Đã xóa báo giá');
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      navigate('/quotes', { replace: true });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (detail.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="card-surface flex items-start gap-3 p-6 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4" />
        <p>{detail.error ? apiErrorMessage(detail.error) : 'Không tìm thấy báo giá'}</p>
      </div>
    );
  }

  const { quote, customer, file, invoice, lines } = detail.data;
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const vat = lines.reduce((s, l) => s + l.qty * l.unitPrice * (l.taxRate ?? 0), 0);
  const exported = invoice?.status === 'exported';

  return (
    <div>
      <PageHeader
        title={`Báo giá ${quote.quoteNo}`}
        description={`Đọc lúc ${formatDate(quote.createdAt)}${file ? ` · ${file.originalName}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-outline" onClick={() => navigate('/quotes')}>
              <ArrowLeft className="h-4 w-4" /> Quay lại
            </button>
            {invoice && (
              <button className="btn-outline" onClick={() => navigate(`/invoices/${invoice.id}`)}>
                <FileText className="h-4 w-4" /> Xem hóa đơn
              </button>
            )}
            <button
              className="btn-outline text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmOpen(true)}
              disabled={exported}
              title={exported ? 'Hóa đơn đã xuất — không thể xóa' : undefined}
            >
              <Trash2 className="h-4 w-4" /> Xóa
            </button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-surface p-5 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Thông tin báo giá</p>
          <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Số báo giá" value={quote.quoteNo} mono />
            <Row label="Ngày báo giá" value={formatDate(quote.quoteDate)} />
            <Row label="Trước VAT" value={formatMoney(quote.declaredSubtotal)} />
            <Row label="VAT" value={formatMoney(quote.declaredVat)} />
            <Row label="Tổng khai báo" value={formatMoney(quote.declaredTotal)} />
            <Row label="Trạng thái" value={invoice ? (exported ? 'Đã xuất hóa đơn' : 'Hóa đơn nháp') : 'Chưa có hóa đơn'} />
          </dl>
          {quote.note && (
            <p className="mt-4 whitespace-pre-line rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
              {quote.note}
            </p>
          )}
        </div>

        <div className="card-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Khách hàng</p>
          {customer ? (
            <div className="mt-3 space-y-1.5 text-sm">
              <p className="font-medium">{customer.name}</p>
              <p className="font-mono text-xs text-muted-foreground">MST {customer.taxCode}</p>
              {customer.address && <p className="text-muted-foreground">{customer.address}</p>}
              {customer.email && <p className="text-muted-foreground">{customer.email}</p>}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Không còn khách hàng gắn với báo giá này.</p>
          )}
        </div>
      </div>

      <div className="card-surface mt-4 overflow-hidden">
        <div className="border-b px-5 py-3.5">
          <p className="text-sm font-medium">Hàng hóa ({lines.length} dòng)</p>
        </div>
        {lines.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Chưa có dòng hàng nào.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="th w-12 text-right">STT</th>
                  <th className="th">Mã hàng</th>
                  <th className="th">Tên hàng</th>
                  <th className="th w-16 text-right">SL</th>
                  <th className="th w-20">ĐVT</th>
                  <th className="th w-32 text-right">Đơn giá</th>
                  <th className="th w-20 text-center">Thuế</th>
                  <th className="th w-36 text-right">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id} className="border-t">
                    <td className="td text-right text-muted-foreground">{i + 1}</td>
                    <td className="td font-mono text-xs">{l.code}</td>
                    <td className="td">{l.name}</td>
                    <td className="td text-right">{l.qty}</td>
                    <td className="td text-muted-foreground">{l.unit}</td>
                    <td className="td text-right">{formatMoney(l.unitPrice)}</td>
                    <td className="td text-center">{formatTaxRate(l.taxRate)}</td>
                    <td className="td text-right font-medium">{formatMoney(Math.round(l.qty * l.unitPrice))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end border-t bg-muted/30 px-5 py-3">
          <dl className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Trước VAT</dt>
              <dd className="tabular-nums">{formatMoney(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">VAT</dt>
              <dd className="tabular-nums">{formatMoney(vat)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
              <dt>Tổng cộng</dt>
              <dd className="tabular-nums">{formatMoney(subtotal + vat)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Xóa báo giá?"
        description={`Báo giá "${quote.quoteNo}" và hóa đơn nháp đi kèm (nếu có) sẽ bị xóa. Không hoàn tác được.`}
        confirmLabel="Xóa"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</dd>
    </div>
  );
}
