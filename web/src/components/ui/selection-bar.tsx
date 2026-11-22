import type { ReactNode } from 'react';
import { Button } from './button';

/**
 * Thanh trạng thái chọn dòng, tách riêng khỏi thanh lọc/tìm kiếm (toolbar) để không
 * bị gộp chung nhìn rối mắt. Dùng chung cho mọi bảng có chọn hàng loạt (hóa đơn,
 * lịch sử báo giá, ...): hiện số lượng đã chọn, nút mở rộng "chọn tất cả khớp bộ lọc",
 * nút bỏ chọn, và một vùng actions tùy trang (xuất Excel, xóa, ...).
 */
export function SelectionBar({
  count,
  total,
  unit,
  allSelected,
  canExpand,
  onExpandAll,
  onClear,
  actions,
}: {
  /** Số dòng đang chọn (trang hiện tại nếu chưa mở rộng). */
  count: number;
  /** Tổng số dòng khớp bộ lọc hiện tại, dùng khi hiện "Đã chọn tất cả N". */
  total: number;
  /** Đơn vị hiển thị, ví dụ "hóa đơn", "báo giá". */
  unit: string;
  /** true khi người dùng đã chọn toàn bộ (vượt quá trang hiện tại). */
  allSelected: boolean;
  /** Cả trang hiện tại đã được chọn hết và còn trang khác -> cho phép mở rộng chọn hết. */
  canExpand?: boolean;
  onExpandAll?: () => void;
  onClear: () => void;
  /** Các nút hành động theo lựa chọn, ví dụ "Xuất Excel", "Xóa". */
  actions?: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      data-chrome
      className="flex flex-wrap items-center justify-between gap-2 border-b bg-primary/5 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-primary">
          {allSelected ? `Đã chọn tất cả ${total} ${unit}` : `Đã chọn ${count} ${unit}`}
        </span>
        {canExpand && onExpandAll && (
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onExpandAll}>
            Chọn cả {total} {unit} khớp bộ lọc
          </Button>
        )}
        <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground" onClick={onClear}>
          Bỏ chọn
        </Button>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
