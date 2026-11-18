import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Download, Loader2, Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { downloadXlsx } from '@/lib/download';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/use-debounced';
import { DataTable, type Column, type SortState } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Pagination } from './customers';

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
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [sort, setSort] = useState<SortState | null>({ key: 'name', dir: 'asc' });

  const sortParam = sort ? (sort.dir === 'desc' ? `-${sort.key}` : sort.key) : 'name';

  const list = useQuery({
    queryKey: ['products', debouncedSearch, page, sortParam],
    queryFn: async () => {
      const { data } = await api.get('/products', {
        params: { search: debouncedSearch, page, pageSize: 20, sort: sortParam },
      });
      return data as { data: Product[]; pagination: { page: number; totalPages: number; total: number } };
    },
  });

  const columns = useMemo<Column<Product>[]>(
    () => [
      { key: 'code', header: 'Mã hàng', sortKey: 'code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
      { key: 'name', header: 'Tên hàng hóa', sortKey: 'name', render: (r) => <span className="font-medium">{r.name}</span> },
      { key: 'unit', header: 'ĐVT', render: (r) => r.unit },
      {
        key: 'actions',
        header: '',
        align: 'right',
        alwaysVisible: true,
        render: (r) => (
          <div className="flex justify-end gap-1">
            <button className="rounded-lg p-2 hover:bg-muted" aria-label="Sửa" onClick={() => { setEditing(r); setOpen(true); }}>
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
            <button
              className="btn-outline"
              onClick={() =>
                downloadXlsx('/export/products.xlsx', 'DSSP.xlsx').catch((e) => toast.error(apiErrorMessage(e)))
              }
            >
              <Download className="h-4 w-4" /> Xuất Excel
            </button>
            <button className="btn-primary" onClick={() => { setEditing(null); setOpen(true); }}>
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
            placeholder="Tìm theo mã hoặc tên…"
            aria-label="Tìm hàng hóa"
            className="input h-9 pl-8"
          />
        </div>
        <span className="text-sm text-muted-foreground">{list.data?.pagination.total ?? 0} hàng hóa</span>
      </div>

      <DataTable
        rows={list.data?.data ?? []}
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
              <button className="btn-primary" onClick={() => { setEditing(null); setOpen(true); }}>
                <Plus className="h-4 w-4" /> Thêm hàng hóa
              </button>
            }
          />
        }
      />

      {list.data && list.data.pagination.totalPages > 1 && (
        <Pagination page={page} totalPages={list.data.pagination.totalPages} onChange={setPage} />
      )}

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
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label htmlFor="p-code" className="label">Mã hàng hóa *</label>
          <input id="p-code" className="input font-mono" {...register('code')} />
          {errors.code && <p className="field-error">{errors.code.message}</p>}
        </div>
        <div>
          <label htmlFor="p-name" className="label">Tên hàng hóa *</label>
          <input id="p-name" className="input" {...register('name')} />
          {errors.name && <p className="field-error">{errors.name.message}</p>}
        </div>
        <div>
          <label htmlFor="p-unit" className="label">Đơn vị tính *</label>
          <input id="p-unit" className="input" {...register('unit')} />
          {errors.unit && <p className="field-error">{errors.unit.message}</p>}
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
