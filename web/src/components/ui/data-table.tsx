import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from 'lucide-react';
import { cn } from '@/lib/utils';

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

  return (
    <div>
      {columnToggle && toggleable.length > 0 && (
        <div className="mb-2 flex justify-end">
          <div ref={pickerRef} className="relative">
            <button
              type="button"
              className="btn-ghost h-8 px-2 text-xs"
              onClick={() => setPickerOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={pickerOpen}
            >
              <Columns3 className="h-3.5 w-3.5" /> Cột
            </button>
            {pickerOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border bg-card p-1 shadow-lift">
                {columns.map((c) => (
                  <label
                    key={c.key}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm',
                      c.alwaysVisible ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-muted',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-input accent-primary"
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
        </div>
      )}

      <div className="table-wrap">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              {onToggle && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả"
                    checked={allChecked}
                    onChange={onToggleAll}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                </th>
              )}
              {visible.map((c) => {
                const active = Boolean(c.sortKey && sort?.key === c.sortKey);
                return (
                  <th
                    key={c.key}
                    className={cn('th', c.className)}
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
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, r) => (
                <tr key={`sk-${r}`} className="border-b last:border-0">
                  {onToggle && <td className="px-4 py-3" />}
                  {visible.map((c) => (
                    <td key={c.key} className="px-4 py-3">
                      <div className="skeleton h-3.5 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={visible.length + (onToggle ? 1 : 0)}>{empty}</td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'group border-b transition-colors last:border-0 hover:bg-muted/50',
                      onRowClick && 'cursor-pointer',
                    )}
                  >
                    {onToggle && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="Chọn dòng"
                          checked={selected?.has(key) ?? false}
                          onChange={() => onToggle(key)}
                          className="h-4 w-4 rounded border-input accent-primary"
                        />
                      </td>
                    )}
                    {visible.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          'td',
                          c.align === 'right' && 'text-right tabular-nums',
                          c.align === 'center' && 'text-center',
                          c.className,
                        )}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
