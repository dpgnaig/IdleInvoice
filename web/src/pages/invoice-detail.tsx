import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { CountUpMoney } from '@/components/ui/count-up';
import { formatMoney, formatTaxRate } from '@/lib/utils';

interface Line {
  id?: number;
  productId: number | null;
  qty: number | null;
  unitPrice: number | null;
  taxRate: number | string;
  code?: string;
  name?: string;
  unit?: string;
}

interface InvoiceDetail {
  id: number;
  status: 'draft' | 'exported';
  paymentMethod: string;
  customerId: number;
  customer: { id: number; name: string; taxCode: string; address: string; email: string };
  lines: Array<Line & { id: number; code: string; name: string; unit: string }>;
  subtotal: number;
  vat: number;
  total: number;
  exportedAt: string | null;
}

const TAX_OPTIONS: ComboOption[] = [
  { value: '0', label: '0%' },
  { value: '0.05', label: '5%' },
  { value: '0.08', label: '8%' },
  { value: '0.1', label: '10%' },
  { value: 'KCT', label: 'KCT' },
  { value: 'KKKNT', label: 'KKKNT' },
];

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invoiceId = Number(id);

  const detail = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: async () => (await api.get<InvoiceDetail>(`/invoices/${invoiceId}`)).data,
  });

  const customers = useQuery({
    queryKey: ['customers-all'],
    queryFn: async () => (await api.get('/customers', { params: { pageSize: 200 } })).data.data as Array<{
      id: number;
      name: string;
      taxCode: string;
    }>,
  });
  const productsQuery = useQuery({
    queryKey: ['products-all'],
    queryFn: async () => (await api.get('/products', { params: { pageSize: 200 } })).data.data as Array<{
      id: number;
      code: string;
      name: string;
      unit: string;
    }>,
  });
  const dup = useQuery({
    queryKey: ['invoice-dup', invoiceId],
    queryFn: async () => (await api.get<{ warnings: string[] }>(`/invoices/${invoiceId}/duplicate-check`)).data.warnings,
  });

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('Chuyển khoản');
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!detail.data) return;
    setCustomerId(detail.data.customerId);
    setPaymentMethod(detail.data.paymentMethod);
    setLines(
      detail.data.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        qty: l.qty,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        code: l.code,
        name: l.name,
        unit: l.unit,
      })),
    );
  }, [detail.data]);

  const customerOptions: ComboOption[] = (customers.data ?? []).map((c) => ({
    value: String(c.id),
    label: c.name,
    hint: `MST ${c.taxCode}`,
  }));
  const productOptions: ComboOption[] = (productsQuery.data ?? []).map((p) => ({
    value: String(p.id),
    label: p.name,
    hint: `${p.code} · ${p.unit}`,
  }));

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + (l.qty ?? 0) * (l.unitPrice ?? 0), 0),
    [lines],
  );
  const vat = useMemo(
    () =>
      lines.reduce(
        (s, l) => s + (l.qty ?? 0) * (l.unitPrice ?? 0) * (typeof l.taxRate === 'number' ? l.taxRate : 0),
        0,
      ),
    [lines],
  );

  const readOnly = detail.data?.status === 'exported';
  const invalid = lines.length === 0 || lines.some((l) => !l.productId || !l.qty || l.unitPrice === null);

  const save = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('Vui lòng chọn khách hàng');
      await api.put(`/invoices/${invoiceId}`, {
        customerId,
        paymentMethod,
        lines: lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate === 'KCT' || l.taxRate === 'KKKNT' ? l.taxRate : Number(l.taxRate),
        })),
      });
    },
    onSuccess: () => {
      toast.success('Đã lưu hóa đơn');
      void qc.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Đang tải hóa đơn…
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return <p className="text-sm text-destructive">{apiErrorMessage(detail.error)}</p>;
  }

  return (
    <div>
      <PageHeader
        title={`Hóa đơn #${invoiceId}`}
        description={detail.data.customer.name}
        actions={
          <>
            <button className="btn-outline" onClick={() => navigate('/invoices')}>
              <ArrowLeft className="h-4 w-4" /> Danh sách
            </button>
            <button
              className="btn-primary"
              disabled={readOnly || invalid || save.isPending}
              onClick={() => void save.mutateAsync()}
              title={readOnly ? 'Hóa đơn đã xuất, không sửa được' : undefined}
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Lưu thay đổi
            </button>
          </>
        }
      />

      {(dup.data ?? []).length > 0 && (
        <div className="mb-4 space-y-1.5">
          {dup.data!.map((w, i) => (
            <p
              key={i}
              className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      <div className="card-surface p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">Khách hàng</label>
            <Combobox
              id="inv-customer"
              options={customerOptions}
              value={customerId ? String(customerId) : null}
              onChange={(v) => setCustomerId(Number(v))}
              disabled={readOnly}
              placeholder="Chọn khách hàng"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              MST {detail.data.customer.taxCode} · {detail.data.customer.address || '—'}
            </p>
          </div>
          <div>
            <label htmlFor="inv-pay" className="label">Hình thức thanh toán</label>
            <input
              id="inv-pay"
              className="input"
              value={paymentMethod}
              disabled={readOnly}
              onChange={(e) => setPaymentMethod(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="th">Mã hàng</th>
                <th className="th w-20">SL</th>
                <th className="th w-32">Đơn giá</th>
                <th className="th w-24">Thuế</th>
                <th className="th w-32 text-right">Thành tiền</th>
                <th className="th w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id ?? `n-${i}`} className="border-t">
                  <td className="px-2 py-2">
                    <Combobox
                      id={`inv-prod-${i}`}
                      options={productOptions}
                      value={l.productId ? String(l.productId) : null}
                      onChange={(v) => {
                        const p = productsQuery.data?.find((x) => String(x.id) === v);
                        setLines((ls) =>
                          ls.map((x, j) =>
                            j === i ? { ...x, productId: Number(v), name: p?.name, code: p?.code, unit: p?.unit } : x,
                          ),
                        );
                      }}
                      disabled={readOnly}
                      placeholder="Chọn hàng hóa"
                    />
                    {l.name && <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{l.name}</p>}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="any"
                      className="input h-9 w-16 px-2 text-right"
                      value={l.qty ?? ''}
                      disabled={readOnly}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) => (j === i ? { ...x, qty: e.target.value ? Number(e.target.value) : null } : x)),
                        )
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      className="input h-9 w-28 px-2 text-right"
                      value={l.unitPrice ?? ''}
                      disabled={readOnly}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) =>
                            j === i ? { ...x, unitPrice: e.target.value ? Number(e.target.value) : null } : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      aria-label="Thuế suất"
                      className="input h-9 w-20 px-2"
                      value={typeof l.taxRate === 'number' ? String(l.taxRate) : l.taxRate}
                      disabled={readOnly}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  taxRate:
                                    e.target.value === 'KCT' || e.target.value === 'KKKNT'
                                      ? e.target.value
                                      : Number(e.target.value),
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      {TAX_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.value === 'KCT' || o.value === 'KKKNT' ? o.value : o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatMoney((l.qty ?? 0) * (l.unitPrice ?? 0))}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label="Xóa dòng"
                      disabled={readOnly}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <button
            className="btn-ghost mt-2 h-8 px-2 text-xs"
            onClick={() => setLines((ls) => [...ls, { productId: null, qty: 1, unitPrice: 0, taxRate: 0.08 }])}
          >
            <Plus className="h-3.5 w-3.5" /> Thêm dòng
          </button>
        )}

        <div className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tổng chưa VAT</span>
            <CountUpMoney value={subtotal} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT</span>
            <CountUpMoney value={vat} />
          </div>
          <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
            <span>Tổng thanh toán</span>
            <CountUpMoney value={subtotal + vat} className="text-primary" />
          </div>
        </div>

        {readOnly && (
          <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            Hóa đơn đã xuất nên chỉ xem được. Thuế suất lưu: {formatTaxRate(lines[0]?.taxRate ?? null)}.
          </p>
        )}
      </div>
    </div>
  );
}
