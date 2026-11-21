import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Download, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { downloadXlsx } from '@/lib/download';
import { useAuth } from '@/lib/auth';
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
  const { ref: tableRef, pageSize } = useAutoPageSize();
  // Số dòng/trang đổi theo kích thước cửa sổ -> quay về trang 1 để không vượt quá số trang
  useEffect(() => setPage(1), [pageSize]);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Customer | null>(null);
  const [sort, setSort] = useState<SortState | null>({ key: 'name', dir: 'asc' });

  const sortParam = sort ? (sort.dir === 'desc' ? `-${sort.key}` : sort.key) : 'name';

  const list = useQuery({
    queryKey: ['customers', debouncedSearch, page, sortParam, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get(endpoints.customers.list, {
        params: { search: debouncedSearch, page, pageSize, sort: sortParam },
      });
      return data as { data: Customer[]; pagination: { page: number; totalPages: number; total: number } };
    },
  });

  const columns = useMemo<Column<Customer>[]>(
    () => [
      { key: 'taxCode', width: '150px', header: 'Mã số thuế', sortKey: 'taxCode', render: (r) => <span className="font-mono text-xs">{r.taxCode}</span> },
      { key: 'name', header: 'Đơn vị mua hàng', sortKey: 'name', render: (r) => <span className="font-medium">{r.name}</span> },
      { key: 'buyerName', width: '180px', header: 'Người mua', render: (r) => r.buyerName || '—' },
      { key: 'email', width: '220px', header: 'Email', render: (r) => <span className="text-muted-foreground">{r.email || '—'}</span> },
      { key: 'address', width: '260px', header: 'Địa chỉ', render: (r) => <span className="text-muted-foreground" title={r.address || undefined}>{r.address || '—'}</span> },
      {
        key: 'actions', width: '104px',
        header: '',
        align: 'right',
        alwaysVisible: true,
        render: (r) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Sửa" onClick={() => { setEditing(r); setDialogOpen(true); }}>
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
    mutationFn: async (id: number) => api.delete(endpoints.customers.byId(id)),
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
            <Button
              variant="outline"
              onClick={() =>
                downloadXlsx('/export/customers.xlsx', 'DSKH.xlsx').catch((e) => toast.error(apiErrorMessage(e)))
              }
            >
              <Download /> Xuất Excel
            </Button>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus /> Thêm mới
            </Button>
          </>
        }
      />

      <DataTable
        cardRef={tableRef}
        toolbar={
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="Tìm theo MST hoặc tên…"
            ariaLabel="Tìm khách hàng"
          />
        }
        footer={
          <Pagination
            page={page}
            totalPages={list.data?.pagination.totalPages ?? 1}
            total={list.data?.pagination.total}
            pageSize={pageSize}
            unit="khách hàng"
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
        storageKey="customers"
        empty={
          <EmptyState
            illustration={<Users className="h-10 w-10 text-muted-foreground" />}
            title="Chưa có khách hàng"
            description="Thêm khách hàng mới hoặc chạy thiết lập ban đầu để import từ Excel."
            action={
              <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus /> Thêm khách hàng
              </Button>
            }
          />
        }
      />

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
      if (customer) await api.put(endpoints.customers.byId(customer.id), values);
      else await api.post(endpoints.customers.list, values);
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
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Mã số thuế *" htmlFor="c-tax" error={errors.taxCode?.message}>
            <Input id="c-tax" className="font-mono" {...register('taxCode')} />
          </Field>
          <Field label="Đơn vị mua hàng *" htmlFor="c-name" error={errors.name?.message}>
            <Input id="c-name" {...register('name')} />
          </Field>
          <Field label="Tên người mua hàng" htmlFor="c-buyer">
            <Input id="c-buyer" {...register('buyerName')} />
          </Field>
          <Field label="Email" htmlFor="c-email" error={errors.email?.message}>
            <Input id="c-email" type="email" {...register('email')} />
          </Field>
          <Field label="Địa chỉ" htmlFor="c-addr" className="sm:col-span-2">
            <Input id="c-addr" {...register('address')} />
          </Field>
          <Field label="CCCD" htmlFor="c-idcard">
            <Input id="c-idcard" {...register('idCard')} />
          </Field>
          <Field label="Số tài khoản" htmlFor="c-bank">
            <Input id="c-bank" {...register('bankAccount')} />
          </Field>
          <Field label="Mã ĐV quan hệ ngân sách" htmlFor="c-budget">
            <Input id="c-budget" {...register('budgetUnitCode')} />
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
