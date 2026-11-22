import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/sonner';
import { Link } from 'react-router-dom';
import { Download, FileText, Loader2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { DataTable, type Column, type SortState } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { SearchInput, SegmentedControl } from '@/components/ui/toolbar';
import { SelectionBar } from '@/components/ui/selection-bar';
import { Pagination } from '@/components/ui/pagination';
import { useAutoPageSize } from '@/lib/use-auto-page-size';
import { useDebounced } from '@/lib/use-debounced';
import { formatDate, formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface InvoiceRow {
  id: number;
  customerName: string;
  customerTaxCode: string;
  status: 'draft' | 'exported';
  paymentMethod: string;
  createdAt: string;
  lineCount: number;
  subtotal: number;
}

export default function InvoicesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | 'draft' | 'exported'>('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const { ref: tableRef, pageSize } = useAutoPageSize();
  // Số dòng/trang đổi theo kích thước cửa sổ -> quay về trang 1 để không vượt quá số trang
  useEffect(() => setPage(1), [pageSize]);
  useEffect(() => setPage(1), [debouncedSearch, status]);
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  // true = đã chọn TOÀN BỘ hóa đơn khớp bộ lọc hiện tại (không chỉ trang đang xem)
  const [selectedAllFiltered, setSelectedAllFiltered] = useState(false);
  const [sort, setSort] = useState<SortState | null>({ key: 'createdAt', dir: 'desc' });

  const list = useQuery({
    queryKey: ['invoices', status, debouncedSearch, page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get(endpoints.invoices.list, {
        params: { status: status || undefined, search: debouncedSearch || undefined, page, pageSize },
      });
      return data as { data: InvoiceRow[]; pagination: { page: number; totalPages: number; total: number } };
    },
  });

  const rows = useMemo(() => {
    const data = list.data?.data ?? [];
    if (!sort) return data;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      switch (sort.key) {
        case 'id':
          return (a.id - b.id) * dir;
        case 'customer':
          return a.customerName.localeCompare(b.customerName, 'vi') * dir;
        case 'subtotal':
          return (a.subtotal - b.subtotal) * dir;
        case 'status':
          return a.status.localeCompare(b.status) * dir;
        case 'createdAt':
        default:
          return a.createdAt.localeCompare(b.createdAt) * dir;
      }
    });
  }, [list.data?.data, sort]);

  const columns = useMemo<Column<InvoiceRow>[]>(
    () => [
      {
        key: 'id', width: '90px',
        header: '#',
        sortKey: 'id',
        render: (r) => (
          <Link to={`/invoices/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
            #{r.id}
          </Link>
        ),
      },
      {
        key: 'customer',
        header: 'Khách hàng',
        sortKey: 'customer',
        render: (r) => (
          <Link to={`/invoices/${r.id}`} className="block truncate" title={`${r.customerName} · MST ${r.customerTaxCode}`}>
            <span className="font-medium hover:underline">{r.customerName}</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">{r.customerTaxCode}</span>
          </Link>
        ),
      },
      { key: 'lines', width: '100px', header: 'Số dòng', align: 'right', render: (r) => r.lineCount },
      { key: 'subtotal', width: '150px', header: 'Tiền hàng', align: 'right', sortKey: 'subtotal', render: (r) => formatMoney(r.subtotal) },
      { key: 'payment', width: '140px', header: 'Thanh toán', render: (r) => r.paymentMethod },
      { key: 'createdAt', width: '130px', header: 'Ngày tạo', sortKey: 'createdAt', render: (r) => formatDate(r.createdAt) },
      {
        key: 'status', width: '130px',
        header: 'Trạng thái',
        sortKey: 'status',
        render: (r) => (
          <Badge variant={r.status === 'draft' ? 'warning' : 'success'}>
            {r.status === 'draft' ? 'Nháp' : 'Đã xuất'}
          </Badge>
        ),
      },
    ],
    [],
  );

  const exportExcel = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await api.post(endpoints.invoices.export, { ids }, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mau_hd_export.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: (_void, ids) => {
      toast.success(`Đã xuất ${ids.length} hóa đơn ra Excel`);
      setSelected(new Set());
      setSelectedAllFiltered(false);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // "Chọn tất cả" khi đã lọc nhiều hơn 1 trang: lấy ID theo ĐÚNG bộ lọc hiện tại
  // từ server, không chỉ những dòng đang hiển thị trên trang này.
  const exportAllIds = useMutation({
    mutationFn: async () => {
      const { data } = await api.get<{ ids: number[] }>(endpoints.invoices.ids, {
        params: { status: status || undefined, search: debouncedSearch || undefined },
      });
      return data.ids;
    },
    onSuccess: (ids) => void exportExcel.mutateAsync(ids),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggle = (k: string | number) => {
    setSelectedAllFiltered(false);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  const total = list.data?.pagination.total ?? 0;
  const pageFullySelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  // Mọi dòng trên trang đã chọn nhưng còn trang khác -> gợi ý mở rộng chọn hết bộ lọc
  const canExpandSelection = pageFullySelected && !selectedAllFiltered && total > rows.length;
  const selectedCount = selectedAllFiltered ? total : selected.size;
  const exporting = exportExcel.isPending || exportAllIds.isPending;

  const doExport = () => {
    if (selectedAllFiltered) void exportAllIds.mutateAsync();
    else void exportExcel.mutateAsync(Array.from(selected).map(Number));
  };

  return (
    <div>
      <PageHeader
        title="Hóa đơn"
        description="Hóa đơn nháp tạo từ báo giá. Chọn các hóa đơn rồi xuất Excel để import lên phần mềm hóa đơn."
      />

      <DataTable
        cardRef={tableRef}
        toolbar={
          <>
            <SegmentedControl
              ariaLabel="Lọc trạng thái"
              value={status}
              onChange={(v) => setStatus(v)}
              options={[
                { value: '', label: 'Tất cả' },
                { value: 'draft', label: 'Nháp' },
                { value: 'exported', label: 'Đã xuất' },
              ]}
            />
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Lọc theo khách hàng, MST…"
              ariaLabel="Lọc hóa đơn theo khách hàng"
            />
          </>
        }
        selectionBar={
          <SelectionBar
            count={selectedCount}
            total={total}
            unit="hóa đơn"
            allSelected={selectedAllFiltered}
            canExpand={canExpandSelection}
            onExpandAll={() => setSelectedAllFiltered(true)}
            onClear={() => { setSelected(new Set()); setSelectedAllFiltered(false); }}
            actions={
              <Button size="sm" disabled={exporting} onClick={doExport}>
                {exporting ? <Loader2 className="animate-spin" /> : <Download />}
                Xuất Excel
              </Button>
            }
          />
        }
        footer={
          <Pagination
            page={page}
            totalPages={list.data?.pagination.totalPages ?? 1}
            total={list.data?.pagination.total}
            pageSize={pageSize}
            unit="hóa đơn"
            onChange={setPage}
          />
        }
        rows={rows}
        pageSize={pageSize}
        fetching={list.isPlaceholderData}
        columns={columns}
        rowKey={(r) => r.id}
        selected={selectedAllFiltered ? new Set(rows.map((r) => r.id)) : selected}
        onToggle={toggle}
        onToggleAll={() => {
          setSelectedAllFiltered(false);
          setSelected((s) => (rows.every((r) => s.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id))));
        }}
        loading={list.isLoading}
        sort={sort}
        onSortChange={setSort}
        columnToggle
        storageKey="invoices"
        empty={
          <EmptyState
            illustration={<FileText className="h-10 w-10 text-muted-foreground" />}
            title="Chưa có hóa đơn"
            description="Vào mục Nhập báo giá để tạo hóa đơn nháp từ báo giá của khách hàng."
          />
        }
      />
    </div>
  );
}
