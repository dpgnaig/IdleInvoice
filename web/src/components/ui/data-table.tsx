import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

/** DataTable responsive; cột suy ra từ `columns`, hỗ trợ sắp xếp và ẩn/hiện cột. */
export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** Khóa sắp xếp gửi lên server, vd "name" / "taxCode". Không có = không sắp xếp được. */
  sortKey?: string;
  /** Không cho ẩn cột này (vd cột thao tác). */
  alwaysVisible?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selected,
  onToggle,
  onToggleAll,
  empty,
  loading,
  onRowClick,
  sort,
  onSortChange,
  columnToggle = false,
  storageKey,
  pageSize,
  fetching,
  toolbar,
  selectionBar,
  footer,
  cardRef,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  selected?: Set<string | number>;
  onToggle?: (key: string | number) => void;
  onToggleAll?: () => void;
  empty?: React.ReactNode;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  sort?: SortState | null;
  onSortChange?: (s: SortState) => void;
  /** Hiện nút chọn cột ẩn/hiện */
  columnToggle?: boolean;
  /** Nhớ lựa chọn cột giữa các lần tải trang */
  storageKey?: string;
  /**
   * Số dòng mỗi trang. Khi có, bảng luôn cao đúng `pageSize` dòng (thêm dòng trống
   * ở trang cuối, skeleton đủ số dòng) để chuyển trang không làm nhảy bố cục.
   */
  pageSize?: number;
  /** Đang tải trang mới trong khi vẫn hiện dữ liệu cũ: làm mờ nhẹ phần thân bảng. */
  fetching?: boolean;
  /** Bộ lọc/tìm kiếm hiển thị trong thanh công cụ trên cùng của khung bảng. */
  toolbar?: React.ReactNode;
  /** Thanh trạng thái chọn dòng (vd <SelectionBar>), hiện ngay dưới toolbar, tách riêng để không bị gộp chung. */
  selectionBar?: React.ReactNode;
  /** Chân khung bảng, thường là <Pagination>. */
  footer?: React.ReactNode;
  /** Ref tới khung bảng, dùng cho useAutoPageSize. */
  cardRef?: React.Ref<HTMLDivElement>;
}) {
  const allChecked = Boolean(
    selected && rows.length > 0 && rows.every((r) => selected.has(rowKey(r))),
  );

  /** Cột đang bị ẩn — lưu vào localStorage để giữ giữa các lần tải trang. */
  const fullKey = storageKey ? `datatable:hidden:${storageKey}` : '';
  const [hidden, setHidden] = React.useState<Set<string>>(() => {
    if (!fullKey) return new Set();
    try {
      const raw = localStorage.getItem(fullKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const pickerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!fullKey) return;
    try {
      localStorage.setItem(fullKey, JSON.stringify([...hidden]));
    } catch {
      /* bỏ qua khi trình duyệt chặn storage */
    }
  }, [hidden, fullKey]);

  React.useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPickerOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const visible = columns.filter((c) => !hidden.has(c.key));
  // table-fixed: bảng không được hẹp hơn tổng cột cố định + tối thiểu 200px cho mỗi cột tự giãn,
  // nếu không cột tự giãn (vd tên khách hàng) bị ép về 0 trên màn hẹp. Hẹp hơn thì cuộn ngang.
  const minTableWidth =
    visible.reduce((sum, c) => {
      const px = c.width ? Number.parseInt(c.width, 10) : Number.NaN;
      return sum + (Number.isFinite(px) ? px : 200);
    }, 0) + (onToggle ? 48 : 0);
  // Luôn giữ ít nhất một cột dữ liệu hiển thị
  const toggleable = columns.filter((c) => !c.alwaysVisible);
  const canHide = toggleable.length > 0 && visible.length > 1;

  const toggleColumn = (key: string) =>
    setHidden((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const clickSort = (c: Column<T>) => {
    if (!c.sortKey || !onSortChange) return;
    const isCurrent = sort?.key === c.sortKey;
    onSortChange({
      key: c.sortKey,
      dir: isCurrent && sort?.dir === 'asc' ? 'desc' : 'asc',
    });
  };

  const showColumnToggle = columnToggle && toggleable.length > 0;
  const hasToolbar = Boolean(toolbar) || showColumnToggle;

  return (
    <div ref={cardRef} className="animate__animated animate__fadeIn rounded-xl border bg-card text-card-foreground shadow-sm">
      {hasToolbar && (
        <div data-chrome className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {showColumnToggle && (
          <div ref={pickerRef} className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={pickerOpen}
            >
              <Columns3 /> Cột
            </Button>
            {pickerOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                {columns.map((c) => (
                  <label
                    key={c.key}
                    className={cn(
                      'flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                      c.alwaysVisible ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent',
                    )}
                  >
                    <Checkbox
                      checked={!hidden.has(c.key)}
                      disabled={c.alwaysVisible || (!hidden.has(c.key) && !canHide)}
                      onChange={() => toggleColumn(c.key)}
                    />
                    {typeof c.header === 'string' ? c.header : c.key}
                  </label>
                ))}
              </div>
            )}
          </div>
          )}
        </div>
      )}
      {selectionBar}

      <Table
        containerClassName={cn(!hasToolbar && 'rounded-t-xl', !footer && 'rounded-b-xl')}
        className="table-fixed"
        style={{ minWidth: minTableWidth }}
      >
        <TableHeader data-chrome className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            {onToggle && (
              <TableHead className="h-9 w-12 px-3">
                <Checkbox aria-label="Chọn tất cả" checked={allChecked} onChange={onToggleAll} />
              </TableHead>
            )}
            {visible.map((c) => {
              const active = Boolean(c.sortKey && sort?.key === c.sortKey);
              return (
                <TableHead
                  key={c.key}
                  className={cn(
                    'h-9 px-3 text-xs',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    c.className,
                  )}
                  style={{ width: c.width }}
                  aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sortKey && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => clickSort(c)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md transition-colors hover:text-foreground',
                        c.align === 'right' && 'w-full justify-end',
                        active && 'text-foreground',
                      )}
                    >
                      {c.header}
                      {active ? (
                        sort?.dir === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody className={cn('transition-opacity duration-150', fetching && !loading && 'opacity-60')}>
          {loading &&
            Array.from({ length: pageSize ?? 5 }).map((_, r) => (
              <TableRow key={`sk-${r}`} className={cn(ROW_HEIGHT, 'hover:bg-transparent')}>
                {onToggle && <TableCell className={CELL} />}
                {visible.map((c) => (
                  <TableCell key={c.key} className={CELL}>
                    <div className="skeleton h-3.5 w-3/4" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          {!loading && rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={visible.length + (onToggle ? 1 : 0)} className="p-0">
                {empty}
              </TableCell>
            </TableRow>
          )}
          {!loading &&
            rows.map((row) => {
              const key = rowKey(row);
              const isSelected = selected?.has(key) ?? false;
              return (
                <TableRow
                  key={key}
                  data-state={isSelected ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('group', ROW_HEIGHT, onRowClick && 'cursor-pointer')}
                >
                  {onToggle && (
                    <TableCell className={CELL}>
                      <Checkbox aria-label="Chọn dòng" checked={isSelected} onChange={() => onToggle(key)} />
                    </TableCell>
                  )}
                  {visible.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        CELL,
                        // table-fixed: nội dung dài bị cắt thay vì nới cột / xuống dòng
                        'overflow-hidden text-ellipsis whitespace-nowrap',
                        c.align === 'right' && 'text-right tabular-nums',
                        c.align === 'center' && 'text-center',
                        c.className,
                      )}
                    >
                      {c.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          {/* Dòng đệm ở trang cuối để chiều cao bảng không đổi */}
          {!loading &&
            pageSize &&
            rows.length > 0 &&
            Array.from({ length: Math.max(0, pageSize - rows.length) }).map((_, r) => (
              <TableRow key={`pad-${r}`} aria-hidden className={cn(ROW_HEIGHT, 'border-0 hover:bg-transparent')}>
                <TableCell colSpan={visible.length + (onToggle ? 1 : 0)} className="p-0" />
              </TableRow>
            ))}
        </TableBody>
      </Table>
      {footer && (
        <div data-chrome className="border-t px-3 py-1.5">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Chiều cao dòng cố định: dòng dữ liệu, skeleton và dòng đệm cao bằng nhau. Khớp TABLE_ROW_PX. */
const ROW_HEIGHT = 'h-10';
const CELL = 'px-3 py-1';
