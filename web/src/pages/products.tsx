import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Download, Loader2, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { downloadXlsx } from '@/lib/download';
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

interface Product {
  id: number;
  code: string;
  name: string;
  unit: string;
}

const schema = z.object({
  code: z.string().min(1, 'Vui lòng nhập mã hàng hóa'),
  name: z.string().min(1, 'Vui lòng nhập tên hàng hóa'),
  unit: z.string().min(1, 'Vui lòng nhập đơn vị tính'),
});

type FormValues = z.infer<typeof schema>;

export default function ProductsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const { ref: tableRef, pageSize } = useAutoPageSize();
  // Số dòng/trang đổi theo kích thước cửa sổ -> quay về trang 1 để không vượt quá số trang
  useEffect(() => setPage(1), [pageSize]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [sort, setSort] = useState<SortState | null>({ key: 'name', dir: 'asc' });

  const sortParam = sort ? (sort.dir === 'desc' ? `-${sort.key}` : sort.key) : 'name';

  const list = useQuery({
    queryKey: ['products', debouncedSearch, page, sortParam, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get('/products', {
        params: { search: debouncedSearch, page, pageSize, sort: sortParam },
      });
      return data as { data: Product[]; pagination: { page: number; totalPages: number; total: number } };
    },
  });

  const columns = useMemo<Column<Product>[]>(
    () => [
      { key: 'code', width: '260px', header: 'Mã hàng', sortKey: 'code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
      { key: 'name', header: 'Tên hàng hóa', sortKey: 'name', render: (r) => <span className="font-medium">{r.name}</span> },
      { key: 'unit', width: '110px', header: 'ĐVT', render: (r) => r.unit },
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
    mutationFn: async (id: number) => api.delete(`/products/${id}`),
    onSuccess: () => { toast.success('Đã xóa hàng hóa'); setToDelete(null); void qc.invalidateQueries({ queryKey: ['products'] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title="Sản phẩm"
        description="Danh mục hàng hóa dùng để ghép mã khi đọc báo giá và xuất hóa đơn."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                downloadXlsx('/export/products.xlsx', 'DSSP.xlsx').catch((e) => toast.error(apiErrorMessage(e)))
              }
            >
              <Download /> Xuất Excel
            </Button>
            <Button onClick={() => { setEditing(null); setOpen(true); }}>
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
            placeholder="Tìm theo mã hoặc tên…"
            ariaLabel="Tìm hàng hóa"
          />
        }
        footer={
          <Pagination
            page={page}
            totalPages={list.data?.pagination.totalPages ?? 1}
            total={list.data?.pagination.total}
            pageSize={pageSize}
            unit="hàng hóa"
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
        storageKey="products"
        empty={
          <EmptyState
            illustration={<Package className="h-10 w-10 text-muted-foreground" />}
            title="Chưa có hàng hóa"
            description="Thêm hàng hóa mới hoặc import danh mục DSSP trong bước thiết lập."
            action={
              <Button onClick={() => { setEditing(null); setOpen(true); }}>
                <Plus /> Thêm hàng hóa
              </Button>
            }
          />
        }
      />

      <ProductDialog
        open={open}
        onOpenChange={setOpen}
        product={editing}
        onSaved={() => { void qc.invalidateQueries({ queryKey: ['products'] }); setOpen(false); }}
      />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Xóa hàng hóa?"
        description={`"${toDelete?.name ?? ''}" sẽ bị xóa. Không thể xóa nếu đang được hóa đơn tham chiếu.`}
        destructive
        confirmLabel="Xóa"
        onConfirm={async () => { if (toDelete) await del.mutateAsync(toDelete.id); }}
      />
    </div>
  );
}

function ProductDialog({
  open, onOpenChange, product, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: Product | null;
  onSaved: () => void;
}) {
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useMemo(() => {
    if (open) reset(product ? { code: product.code, name: product.name, unit: product.unit } : { code: '', name: '', unit: '' });
  }, [open, product, reset]);

  const onSubmit = async (values: FormValues) => {
    try {
      if (product) await api.put(`/products/${product.id}`, values);
      else await api.post('/products', values);
      toast.success(product ? 'Đã cập nhật hàng hóa' : 'Đã thêm hàng hóa');
      onSaved();
    } catch (err) {
      const msg = apiErrorMessage(err);
      if (/mã hàng/i.test(msg)) setError('code', { message: msg });
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={product ? 'Sửa hàng hóa' : 'Thêm hàng hóa'}>
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
        <Field label="Mã hàng hóa *" htmlFor="p-code" error={errors.code?.message}>
          <Input id="p-code" className="font-mono" {...register('code')} />
        </Field>
        <Field label="Tên hàng hóa *" htmlFor="p-name" error={errors.name?.message}>
          <Input id="p-name" {...register('name')} />
        </Field>
        <Field label="Đơn vị tính *" htmlFor="p-unit" error={errors.unit?.message}>
          <Input id="p-unit" {...register('unit')} />
        </Field>
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
