import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Chiều cao một dòng bảng (px). Phải khớp ROW_HEIGHT trong data-table.tsx (h-10). */
export const TABLE_ROW_PX = 40;

/**
 * Tính số dòng mỗi trang sao cho cả khung bảng vừa màn hình, không phải cuộn trang.
 *
 * Gắn `ref` vào khung bảng (DataTable `cardRef`). Hook đo vị trí đỉnh khung, cộng chiều cao
 * các phần cố định trong khung (thanh công cụ, header, chân bảng, đánh dấu `data-chrome`)
 * và padding dưới của <main>, phần còn lại chia cho chiều cao dòng.
 * Phần nằm phía trên khung không phụ thuộc số dòng nên phép đo không tạo vòng lặp.
 */
export function useAutoPageSize({ min = 5, max = 50 }: { min?: number; max?: number } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  // Ước lượng ban đầu để query đầu tiên đã gần đúng
  const [pageSize, setPageSize] = useState(() =>
    clamp(Math.floor((window.innerHeight - 330) / TABLE_ROW_PX), min, max),
  );

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Dùng offsetTop thay vì getBoundingClientRect để không bị lệch bởi hiệu ứng trượt khi chuyển trang
    let top = 0;
    for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
    let chrome = 0;
    el.querySelectorAll<HTMLElement>('[data-chrome]').forEach((c) => { chrome += c.offsetHeight; });
    const main = document.getElementById('main');
    const padBottom = main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 0 : 24;
    const borders = 2; // viền trên + dưới của khung
    const available = window.innerHeight - top - chrome - padBottom - borders;
    const next = clamp(Math.floor(available / TABLE_ROW_PX), min, max);
    setPageSize((prev) => (prev === next ? prev : next));
  }, [min, max]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(measure, 120);
    };
    window.addEventListener('resize', onResize);
    // đo lại khi font/ảnh tải xong làm đổi vị trí khung
    const late = setTimeout(measure, 300);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(t);
      clearTimeout(late);
    };
  }, [measure]);

  return { ref, pageSize };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}
