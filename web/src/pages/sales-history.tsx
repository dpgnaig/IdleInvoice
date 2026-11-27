import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from '@/components/ui/sonner';
import { Loader2, Pencil, Plus, Receipt, Trash2, Upload } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/use-debounced';
import { DataTable, type Column, type SortState } from '@/components/ui/data-table';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/ui/toolbar';
import { Pagination } from '@/components/ui/pagination';
import { useAutoPageSize } from '@/lib/use-auto-page-size';

interface HistoryRow {
  id: number;
  invoiceNo: string;
  invoiceDate: string | null;
  customerTaxCode: string;
  productCode: string;
  productName: string;
  unit: string;
  qty: number;
  unitPrice: number;
  taxRate: number;
}

const numberOk = (v: string) => v.trim() !== '' && !Number.isNaN(Number(v)) && Number(v) >= 0;

const schema = z.object({
  invoiceNo: z.string(),
  invoiceDate: z.string(),
  customerTaxCode: z.string().trim().min(1, 'Vui lòng nhập mã số thuế khách hàng'),
  productCode: z.string().trim().min(1, 'Vui lòng nhập mã hàng'),
  productName: z.string().trim().min(1, 'Vui lòng nhập tên hàng'),
  unit: z.string(),
  qty: z.string().refine(numberOk, 'Số lượng không hợp lệ'),
  unitPrice: z.string().refine((v) => numberOk(v) && Number.isInteger(Number(v)), 'Đơn giá phải là số nguyên không âm'),
  taxRate: z.string().refine((v) => numberOk(v) && Number(v) <= 100, 'Thuế suất từ 0 đến 100 (%)'),
});

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = {
  invoiceNo: '',
  invoiceDate: '',
  customerTaxCode: '',
  productCode: '',
  productName: '',
  unit: '',
  qty: '1',
  unitPrice: '0',
  taxRate: '8',
};

const money = new Intl.NumberFormat('vi-VN');

function formatDate(iso: string | null) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

function toForm(r: HistoryRow): FormValues {
  return {
    invoiceNo: r.invoiceNo,
    invoiceDate: r.invoiceDate ? r.invoiceDate.slice(0, 10) : '',
    customerTaxCode: r.customerTaxCode,
    productCode: r.productCode,
    productName: r.productName,
    unit: r.unit,
    qty: String(r.qty),
    unitPrice: String(r.unitPrice),
    taxRate: String(Math.round(r.taxRate * 10000) / 100),
  };
}

export default function SalesHistoryPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const { ref: tableRef, pageSize } = useAutoPageSize();
  useEffect(() => setPage(1), [pageSize]);
  const [editing, setEditing] = useState<HistoryRow | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<HistoryRow | null>(null);
  const [sort, setSort] = useState<SortState | null>({ key: 'invoiceDate', dir: 'desc' });

  const sortParam = sort ? (sort.dir === 'desc' ? `-${sort.key}` : sort.key) : '-invoiceDate';

  const list = useQuery({
    queryKey: ['sales-history', debouncedSearch, page, sortParam, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get(endpoints.salesHistory.list, {
        params: { search: debouncedSearch, page, pageSize, sort: sortParam },
      });
      return data as { data: HistoryRow[]; pagination: { page: number; totalPages: number; total: number } };
    },
  });

  const columns = useMemo<Column<HistoryRow>[]>(
    () => [
      { key: 'invoiceDate', width: '110px', header: 'Ngày HĐ', sortKey: 'invoiceDate', render: (r) => formatDate(r.invoiceDate) },
      { key: 'invoiceNo', width: '110px', header: 'Số HĐ', sortKey: 'invoiceNo', render: (r) => <span className="font-mono text-xs">{r.invoiceNo}</span> },
      { key: 'customerTaxCode', width: '140px', header: 'MST khách hàng', sortKey: 'customerTaxCode', render: (r) => <span className="font-mono text-xs">{r.customerTaxCode}</span> },
      { key: 'productCode', width: '180px', header: 'Mã hàng', sortKey: 'productCode', render: (r) => <span className="font-mono text-xs">{r.productCode}</span> },
      { key: 'productName', header: 'Tên hàng', sortKey: 'productName', render: (r) => <span className="font-medium">{r.productName}</span> },
      { key: 'unit', width: '80px', header: 'ĐVT', render: (r) => r.unit },
      { key: 'qty', width: '90px', header: 'SL', sortKey: 'qty', align: 'right', render: (r) => money.format(r.qty) },
      { key: 'unitPrice', width: '120px', header: 'Đơn giá', sortKey: 'unitPrice', align: 'right', render: (r) => money.format(r.unitPrice) },
      { key: 'taxRate', width: '80px', header: 'Thuế', align: 'right', render: (r) => `${Math.round(r.taxRate * 10000) / 100}%` },
      {
        key: 'actions', width: '104px',
        header: '',
        align: 'right',
        alwaysVisible: true,
        render: (r) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Sửa" onClick={() => { setEditing(r); setOpen(true); }}>
              <Pencil />
            </Button>
            {user?.role === 'admin' && (
              <Button variant="ghost" size="icon-sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label="Xóa" onClick={() => setToDelete(r)}>
                <Trash2 />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [user?.role],
  );

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(endpoints.salesHistory.byId(id)),
    onSuccess: () => { toast.success('Đã xóa dòng lịch sử'); setToDelete(null); void qc.invalidateQueries({ queryKey: ['sales-history'] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const importFile = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post<{ total: number; added: number; skipped: number }>(endpoints.salesHistory.import, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: (d) => {
      toast.success(`Đã nhập ${d.added} dòng lịch sử, bỏ qua ${d.skipped} dòng đã có`);
      setPage(1);
      void qc.invalidateQueries({ queryKey: ['sales-history'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
    onSettled: () => {
      if (fileRef.current) fileRef.current.value = '';
    },
  });

  return (
    <div>
      <PageHeader
        title="Lịch sử bán hàng"
        description="Các hóa đơn đã xuất trước đây, dùng để gợi ý giá, số lượng gần nhất và cảnh báo xuất trùng."
        actions={
          <div className="flex items-center gap-2">
            {user?.role === 'admin' && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFile.mutate(f);
                  }}
                />
                <Button variant="outline" disabled={importFile.isPending} onClick={() => fileRef.current?.click()}>
                  {importFile.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Nhập từ Excel
                </Button>
              </>
            )}
            <Button onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus /> Thêm mới
            </Button>
          </div>
        }
      />

      <DataTable
        cardRef={tableRef}
        toolbar={
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="Tìm theo số HĐ, MST, mã hoặc tên hàng…"
            ariaLabel="Tìm lịch sử bán hàng"
          />
        }
        footer={
          <Pagination
            page={page}
            totalPages={list.data?.pagination.totalPages ?? 1}
            total={list.data?.pagination.total}
            pageSize={pageSize}
            unit="dòng"
            onChange={setPage}
          />
        }
        rows={list.data?.data ?? []}
        pageSize={pageSize}
        fetching={list.isPlaceholderData}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        columnToggle
        storageKey="sales-history"
        empty={
          <EmptyState
            illustration={<Receipt className="h-10 w-10 text-muted-foreground" />}
            title="Chưa có lịch sử bán hàng"
            description="Thêm thủ công hoặc nhập file lịch sử hóa đơn ExportFast.xlsx (admin)."
            action={
              <Button onClick={() => { setEditing(null); setOpen(true); }}>
                <Plus /> Thêm dòng
              </Button>
            }
          />
        }
      />

      <HistoryDialog
        open={open}
        onOpenChange={setOpen}
        row={editing}
        onSaved={() => { void qc.invalidateQueries({ queryKey: ['sales-history'] }); setOpen(false); }}
      />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Xóa dòng lịch sử?"
        description={`Dòng "${toDelete?.productName ?? ''}" (HĐ ${toDelete?.invoiceNo || '—'}) sẽ bị xóa và không còn dùng để gợi ý giá hay cảnh báo xuất trùng.`}
        destructive
        confirmLabel="Xóa"
        onConfirm={async () => { if (toDelete) await del.mutateAsync(toDelete.id); }}
      />
    </div>
  );
}

function HistoryDialog({
  open, onOpenChange, row, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: HistoryRow | null;
  onSaved: () => void;
}) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (open) reset(row ? toForm(row) : EMPTY);
  }, [open, row, reset]);

  const onSubmit = async (v: FormValues) => {
    const payload = {
      invoiceNo: v.invoiceNo.trim(),
      invoiceDate: v.invoiceDate || null,
      customerTaxCode: v.customerTaxCode,
      productCode: v.productCode,
      productName: v.productName,
      unit: v.unit.trim(),
      qty: Number(v.qty),
      unitPrice: Number(v.unitPrice),
      taxRate: Number(v.taxRate) / 100,
    };
    try {
      if (row) await api.put(endpoints.salesHistory.byId(row.id), payload);
      else await api.post(endpoints.salesHistory.list, payload);
      toast.success(row ? 'Đã cập nhật dòng lịch sử' : 'Đã thêm dòng lịch sử');
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={row ? 'Sửa dòng lịch sử' : 'Thêm dòng lịch sử'}>
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Số hóa đơn" htmlFor="h-no" error={errors.invoiceNo?.message}>
            <Input id="h-no" className="font-mono" {...register('invoiceNo')} />
          </Field>
          <Field label="Ngày hóa đơn" htmlFor="h-date" error={errors.invoiceDate?.message}>
            <Input id="h-date" type="date" {...register('invoiceDate')} />
          </Field>
        </div>
        <Field label="MST khách hàng *" htmlFor="h-tax" error={errors.customerTaxCode?.message}>
          <Input id="h-tax" className="font-mono" {...register('customerTaxCode')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mã hàng *" htmlFor="h-code" error={errors.productCode?.message}>
            <Input id="h-code" className="font-mono" {...register('productCode')} />
          </Field>
          <Field label="Đơn vị tính" htmlFor="h-unit" error={errors.unit?.message}>
            <Input id="h-unit" {...register('unit')} />
          </Field>
        </div>
        <Field label="Tên hàng *" htmlFor="h-name" error={errors.productName?.message}>
          <Input id="h-name" {...register('productName')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Số lượng *" htmlFor="h-qty" error={errors.qty?.message}>
            <Input id="h-qty" inputMode="decimal" {...register('qty')} />
          </Field>
          <Field label="Đơn giá *" htmlFor="h-price" error={errors.unitPrice?.message}>
            <Input id="h-price" inputMode="numeric" {...register('unitPrice')} />
          </Field>
          <Field label="Thuế suất (%) *" htmlFor="h-tax-rate" error={errors.taxRate?.message}>
            <Input id="h-tax-rate" inputMode="decimal" {...register('taxRate')} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />} Lưu
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
