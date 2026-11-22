import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/sonner';
import { AlertTriangle, ArrowLeft, FileText, Loader2, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
    queryFn: async () => (await api.get<QuoteDetail>(endpoints.quotes.byId(quoteId))).data,
  });

  const remove = useMutation({
    mutationFn: async () => api.delete(endpoints.quotes.byId(quoteId)),
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
      <Card className="flex items-start gap-3 p-5 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4" />
        <p>{detail.error ? apiErrorMessage(detail.error) : 'Không tìm thấy báo giá'}</p>
      </Card>
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
            <Button variant="outline" onClick={() => navigate('/quotes')}>
              <ArrowLeft /> Quay lại
            </Button>
            {invoice && (
              <Button variant="outline" onClick={() => navigate(`/invoices/${invoice.id}`)}>
                <FileText /> Xem hóa đơn
              </Button>
            )}
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={exported}
              title={exported ? 'Hóa đơn đã xuất — không thể xóa' : undefined}
            >
              <Trash2 /> Xóa
            </Button>
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-3 animate__animated animate__fadeIn">
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
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
            <p className="mt-4 whitespace-pre-line rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
              {quote.note}
            </p>
          )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Khách hàng</p>
          {customer ? (
            <div className="mt-3 grid gap-1.5 text-sm">
              <p className="font-medium">{customer.name}</p>
              <p className="font-mono text-xs text-muted-foreground">MST {customer.taxCode}</p>
              {customer.address && <p className="text-muted-foreground">{customer.address}</p>}
              {customer.email && <p className="text-muted-foreground">{customer.email}</p>}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Không còn khách hàng gắn với báo giá này.</p>
          )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden animate__animated animate__fadeIn">
        <div className="border-b px-5 py-3.5">
          <p className="text-sm font-medium">Hàng hóa ({lines.length} dòng)</p>
        </div>
        {lines.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Chưa có dòng hàng nào.</p>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 px-4 text-right">STT</TableHead>
                <TableHead className="px-4">Mã hàng</TableHead>
                <TableHead className="px-4">Tên hàng</TableHead>
                <TableHead className="w-16 px-4 text-right">SL</TableHead>
                <TableHead className="w-20 px-4">ĐVT</TableHead>
                <TableHead className="w-32 px-4 text-right">Đơn giá</TableHead>
                <TableHead className="w-20 px-4 text-center">Thuế</TableHead>
                <TableHead className="w-36 px-4 text-right">Thành tiền</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell className="px-4 py-3 text-right text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="px-4 py-3 font-mono text-xs">{l.code}</TableCell>
                  <TableCell className="px-4 py-3">{l.name}</TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums">{l.qty}</TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{l.unit}</TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums">{formatMoney(l.unitPrice)}</TableCell>
                  <TableCell className="px-4 py-3 text-center">{formatTaxRate(l.taxRate)}</TableCell>
                  <TableCell className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatMoney(Math.round(l.qty * l.unitPrice))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex justify-end border-t bg-muted/30 px-5 py-4">
          <dl className="grid w-full max-w-xs gap-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Trước VAT</dt>
              <dd className="tabular-nums">{formatMoney(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">VAT</dt>
              <dd className="tabular-nums">{formatMoney(vat)}</dd>
            </div>
            <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
              <dt>Tổng cộng</dt>
              <dd className="tabular-nums">{formatMoney(subtotal + vat)}</dd>
            </div>
          </dl>
        </div>
      </Card>

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
