import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Download, Loader2, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { downloadXlsx } from '@/lib/download';
import { useAuth } from '@/lib/auth';
import { DataTable, type Column, type SortState } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';
import { useDebounced } from '@/lib/use-debounced';

export interface Customer {
  id: number;
  taxCode: string;
  name: string;
  address: string;
  email: string;
  buyerName: string;
  idCard: string;
  bankAccount: string;
  budgetUnitCode: string;
  source: string;
}

const schema = z.object({
  taxCode: z.string().min(1, 'Vui lòng nhập mã số thuế'),
  name: z.string().min(1, 'Vui lòng nhập tên đơn vị'),
  buyerName: z.string().optional().default(''),
  address: z.string().optional().default(''),
  email: z.union([z.string().email('Email không hợp lệ'), z.literal('')]).optional().default(''),
  idCard: z.string().optional().default(''),
  bankAccount: z.string().optional().default(''),
  budgetUnitCode: z.string().optional().default(''),
});

type FormValues = z.infer<typeof schema>;

export default function CustomersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Customer | null>(null);
  const [sort, setSort] = useState<SortState | null>({ key: 'name', dir: 'asc' });

  const sortParam = sort ? (sort.dir === 'desc' ? `-${sort.key}` : sort.key) : 'name';

  const list = useQuery({
    queryKey: ['customers', debouncedSearch, page, sortParam],
    queryFn: async () => {
      const { data } = await api.get('/customers', {
        params: { search: debouncedSearch, page, pageSize: 20, sort: sortParam },
      });
      return data as { data: Customer[]; pagination: { page: number; totalPages: number; total: number } };
    },
  });

  const columns = useMemo<Column<Customer>[]>(
    () => [
      { key: 'taxCode', header: 'Mã số thuế', sortKey: 'taxCode', render: (r) => <span className="font-mono text-xs">{r.taxCode}</span> },
      { key: 'name', header: 'Đơn vị mua hàng', sortKey: 'name', render: (r) => <span className="font-medium">{r.name}</span> },
      { key: 'buyerName', header: 'Người mua', render: (r) => r.buyerName || '—' },
      { key: 'email', header: 'Email', render: (r) => <span className="text-muted-foreground">{r.email || '—'}</span> },
      { key: 'address', header: 'Địa chỉ', render: (r) => <span className="line-clamp-1 max-w-[280px] text-muted-foreground">{r.address || '—'}</span> },
      {
        key: 'actions',
        header: '',
        align: 'right',
        alwaysVisible: true,
        render: (r) => (
          <div className="flex justify-end gap-1">
            <button className="rounded-lg p-2 hover:bg-muted" aria-label="Sửa" onClick={() => { setEditing(r); setDialogOpen(true); }}>
              <Pencil className="h-4 w-4" />
            </button>
            {user?.role === 'admin' && (
              <button className="rounded-lg p-2 text-destructive hover:bg-destructive/10" aria-label="Xóa" onClick={() => setToDelete(r)}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ),
      },
    ],
    [user?.role],
  );

  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/customers/${id}`),
    onSuccess: () => { toast.success('Đã xóa khách hàng'); setToDelete(null); void qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title="Khách hàng"
        description="Danh sách khách hàng dùng để ghép khi đọc báo giá."
        actions={
          <>
            <button
              className="btn-outline"
              onClick={() =>
                downloadXlsx('/export/customers.xlsx', 'DSKH.xlsx').catch((e) => toast.error(apiErrorMessage(e)))
              }
            >
              <Download className="h-4 w-4" /> Xuất Excel
            </button>
            <button className="btn-primary" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4" /> Thêm mới
            </button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Tìm theo MST hoặc tên…"
            aria-label="Tìm khách hàng"
            className="input h-9 pl-8"
          />
        </div>
        <span className="text-sm text-muted-foreground">{list.data?.pagination.total ?? 0} khách hàng</span>
      </div>

      <DataTable
        rows={list.data?.data ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        sort={sort}
        onSortChange={(s) => { setSort(s); setPage(1); }}
        columnToggle
        storageKey="customers"
        empty={
          <EmptyState
            illustration={<Users className="h-10 w-10 text-muted-foreground" />}
            title="Chưa có khách hàng"
            description="Thêm khách hàng mới hoặc chạy thiết lập ban đầu để import từ Excel."
            action={
              <button className="btn-primary" onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus className="h-4 w-4" /> Thêm khách hàng
              </button>
            }
          />
        }
      />

      {list.data && list.data.pagination.totalPages > 1 && (
        <Pagination page={page} totalPages={list.data.pagination.totalPages} onChange={setPage} />
      )}

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customer={editing}
        onSaved={() => { void qc.invalidateQueries({ queryKey: ['customers'] }); setDialogOpen(false); }}
      />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Xóa khách hàng?"
        description={`Khách hàng "${toDelete?.name ?? ''}" sẽ bị xóa. Không thể xóa nếu đang được hóa đơn tham chiếu.`}
        destructive
        confirmLabel="Xóa"
        onConfirm={async () => { if (toDelete) await del.mutateAsync(toDelete.id); }}
      />
    </div>
  );
}

function CustomerDialog({
  open, onOpenChange, customer, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: Customer | null;
  onSaved: () => void;
}) {
  const {
    register, handleSubmit, reset, setError, formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { taxCode: '', name: '', buyerName: '', address: '', email: '', idCard: '', bankAccount: '', budgetUnitCode: '' },
  });

  // reset khi mở với khách khác
  useMemo(() => {
    if (open) {
      reset(
        customer
          ? {
              taxCode: customer.taxCode, name: customer.name, buyerName: customer.buyerName,
              address: customer.address, email: customer.email, idCard: customer.idCard,
              bankAccount: customer.bankAccount, budgetUnitCode: customer.budgetUnitCode,
            }
          : { taxCode: '', name: '', buyerName: '', address: '', email: '', idCard: '', bankAccount: '', budgetUnitCode: '' },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer]);

  const onSubmit = async (values: FormValues) => {
    try {
      if (customer) await api.put(`/customers/${customer.id}`, values);
      else await api.post('/customers', values);
      toast.success(customer ? 'Đã cập nhật khách hàng' : 'Đã thêm khách hàng');
      onSaved();
    } catch (err) {
      const msg = apiErrorMessage(err);
      if (/mã số thuế/i.test(msg)) setError('taxCode', { message: msg });
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={customer ? 'Sửa khách hàng' : 'Thêm khách hàng'} className="max-w-2xl">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="c-tax" className="label">Mã số thuế *</label>
            <input id="c-tax" className="input font-mono" {...register('taxCode')} />
            {errors.taxCode && <p className="field-error">{errors.taxCode.message}</p>}
          </div>
          <div>
            <label htmlFor="c-name" className="label">Đơn vị mua hàng *</label>
            <input id="c-name" className="input" {...register('name')} />
            {errors.name && <p className="field-error">{errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor="c-buyer" className="label">Tên người mua hàng</label>
            <input id="c-buyer" className="input" {...register('buyerName')} />
          </div>
          <div>
            <label htmlFor="c-email" className="label">Email</label>
            <input id="c-email" type="email" className="input" {...register('email')} />
            {errors.email && <p className="field-error">{errors.email.message}</p>}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="c-addr" className="label">Địa chỉ</label>
            <input id="c-addr" className="input" {...register('address')} />
          </div>
          <div>
            <label htmlFor="c-idcard" className="label">CCCD</label>
            <input id="c-idcard" className="input" {...register('idCard')} />
          </div>
          <div>
            <label htmlFor="c-bank" className="label">Số tài khoản</label>
            <input id="c-bank" className="input" {...register('bankAccount')} />
          </div>
          <div>
            <label htmlFor="c-budget" className="label">Mã ĐV quan hệ ngân sách</label>
            <input id="c-budget" className="input" {...register('budgetUnitCode')} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-outline" onClick={() => onOpenChange(false)}>Hủy</button>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />} Lưu
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <button className="btn-outline h-8 px-3 text-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>Trước</button>
      <span className="text-sm text-muted-foreground">Trang {page} / {totalPages}</span>
      <button className={cn('btn-outline h-8 px-3 text-xs')} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Sau</button>
    </div>
  );
}
