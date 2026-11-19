import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from './button';

/** Danh sách số trang có dấu "…", luôn giữ trang đầu, trang cuối và hai bên trang hiện tại. */
function pageItems(page: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const items: Array<number | 'gap'> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) items.push('gap');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < totalPages - 1) items.push('gap');
  items.push(totalPages);
  return items;
}

/**
 * Chân bảng theo Pagination của shadcn/ui: "1–20 / 345 khách hàng" bên trái, điều hướng bên phải.
 * Luôn hiển thị (kể cả khi chỉ có 1 trang) để chiều cao khung bảng không đổi.
 */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  unit = 'dòng',
  onChange,
}: {
  page: number;
  totalPages: number;
  total?: number;
  pageSize?: number;
  unit?: string;
  onChange: (p: number) => void;
}) {
  const safeTotalPages = Math.max(1, totalPages);
  const from = total && pageSize ? (page - 1) * pageSize + 1 : 0;
  const to = total && pageSize ? Math.min(total, page * pageSize) : 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs tabular-nums text-muted-foreground">
        {total == null
          ? `Trang ${page} / ${safeTotalPages}`
          : total === 0
            ? `0 ${unit}`
            : `${from.toLocaleString('vi-VN')}–${to.toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} ${unit}`}
      </p>
      <nav className="flex items-center gap-1" aria-label="Phân trang">
        <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => onChange(1)} aria-label="Trang đầu">
          <ChevronsLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Trang trước">
          <ChevronLeft />
        </Button>
        {pageItems(page, safeTotalPages).map((it, i) =>
          it === 'gap' ? (
            <span key={`gap-${i}`} className="flex h-8 w-8 items-center justify-center text-xs text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={it}
              variant={it === page ? 'outline' : 'ghost'}
              size="icon-sm"
              className="tabular-nums"
              aria-current={it === page ? 'page' : undefined}
              onClick={() => onChange(it)}
            >
              {it}
            </Button>
          ),
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page >= safeTotalPages}
          onClick={() => onChange(page + 1)}
          aria-label="Trang sau"
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page >= safeTotalPages}
          onClick={() => onChange(safeTotalPages)}
          aria-label="Trang cuối"
        >
          <ChevronsRight />
        </Button>
      </nav>
    </div>
  );
}
