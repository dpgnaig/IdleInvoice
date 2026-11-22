import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
  /** Mã hàng/định danh chính xác — dùng để xếp khớp mã lên trước khớp mờ. */
  code?: string;
  /** Chuỗi phụ để lọc (mã hàng, MST, tên không dấu…). Mặc định dùng label + hint. */
  keywords?: string;
}

/** Khóa tìm kiếm: bỏ dấu tiếng Việt, viết thường, bỏ ký tự không phải chữ/số. */
function searchKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Hạng khớp của một mục (số nhỏ = khớp hơn, -1 = không khớp).
 * Mã hàng được so NGUYÊN VĂN trước ("HD-270" không bị trộn với "HD270"),
 * chỉ khi không khớp nguyên văn mới rơi xuống so bỏ dấu/không gạch nối.
 */
function matchRank(o: ComboOption, qRaw: string, qKey: string): number {
  const label = o.label.toLowerCase();
  const hint = (o.hint ?? '').toLowerCase();
  if (o.code) {
    const code = o.code.toLowerCase().trim();
    if (code === qRaw) return 0;
    if (code.startsWith(qRaw)) return 1;
    if (code.includes(qRaw)) return 2;
    if (qKey) {
      const codeKey = searchKey(code);
      if (codeKey === qKey) return 3;
      if (codeKey.includes(qKey)) return 4;
    }
  }
  if (label.includes(qRaw) || hint.includes(qRaw)) return 5;
  if (qKey && searchKey(o.keywords ?? `${label} ${hint} ${o.value}`).includes(qKey)) return 6;
  return -1;
}

/** Chiều cao cố định của mỗi dòng — cần cho cuộn ảo (windowed rendering). */
const ITEM_H = 44;
const OVERSCAN = 6;
/** Chiều cao vùng nhìn của danh sách (khớp maxHeight 256px + đệm). */
const VIEW_H = 280;

/**
 * Combobox có tìm kiếm, điều khiển bằng bàn phím (↑ ↓ Enter Esc).
 * `onSearch` cho phép lọc phía server (debounce do nơi gọi xử lý).
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Chọn…',
  searchPlaceholder = 'Tìm kiếm…',
  onSearch,
  loading,
  emptyText = 'Không có kết quả',
  allowCustom = false,
  customHint = 'Dùng giá trị đã nhập',
  id,
  disabled,
  className,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (v: string, option: ComboOption) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  onSearch?: (q: string) => void;
  loading?: boolean;
  emptyText?: string;
  /** Cho phép dùng luôn chuỗi đang gõ nếu không có trong danh sách (vd. tên model tuỳ chỉnh). */
  allowCustom?: boolean;
  customHint?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const reduce = useReducedMotion();

  const selected = options.find((o) => o.value === value);

  const filtered = React.useMemo(() => {
    if (onSearch) return options; // lọc phía server
    const qRaw = query.trim().toLowerCase();
    if (!qRaw) return options;
    const qKey = searchKey(qRaw);
    const ranked: Array<{ o: ComboOption; rank: number }> = [];
    for (const o of options) {
      const rank = matchRank(o, qRaw, qKey);
      if (rank >= 0) ranked.push({ o, rank });
    }
    ranked.sort((a, b) => a.rank - b.rank); // stable: giữ thứ tự gốc trong cùng hạng
    return ranked.map((r) => r.o);
  }, [options, query, onSearch]);

  // Cho phép chọn luôn giá trị tự gõ khi không trùng mục nào (mặc định không bật)
  const shown = React.useMemo(() => {
    const q = query.trim();
    if (!allowCustom || !q) return filtered;
    if (options.some((o) => o.value === q || o.label === q)) return filtered;
    return [{ value: q, label: q, hint: customHint }, ...filtered];
  }, [allowCustom, customHint, filtered, options, query]);

  // Cửa sổ render: chỉ dựng các dòng đang nằm trong vùng nhìn (+ đệm)
  const start = Math.max(0, Math.floor(scrollTop / ITEM_H) - OVERSCAN);
  const end = Math.min(shown.length, Math.ceil((scrollTop + VIEW_H) / ITEM_H) + OVERSCAN);
  const visible = shown.slice(start, end);

  React.useEffect(() => {
    if (!open) return;
    // Bám theo ô chọn khi trang/khung cha cuộn hoặc đổi kích thước (giống Radix Popover)
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        // Ô chọn đã cuộn khuất hẳn khỏi màn hình -> đóng thay vì treo popup lơ lửng
        if (r.bottom < 0 || r.top > window.innerHeight) setOpen(false);
        else setRect(r);
      });
    };
    update();
    window.addEventListener('scroll', update, true); // capture: bắt cả cuộn của khung cha
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Dùng phím ↑↓ thì cuộn mục đang chọn vào vùng nhìn thấy (danh sách chỉ render một cửa sổ)
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    const top = active * ITEM_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ITEM_H > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ITEM_H - el.clientHeight;
    }
  }, [active, open]);

  // Vừa mở: nhảy tới đúng vị trí mục đang chọn (giữa danh sách) thay vì luôn từ đầu
  const jumpedRef = React.useRef(false);
  React.useEffect(() => {
    if (!open) {
      jumpedRef.current = false;
      return;
    }
    const el = listRef.current;
    if (!el || jumpedRef.current) return;
    jumpedRef.current = true;
    const idx = shown.findIndex((o) => o.value === value);
    if (idx <= 0) return;
    setActive(idx);
    const nextTop = Math.max(0, idx * ITEM_H - ITEM_H * 3);
    el.scrollTop = nextTop;
    setScrollTop(nextTop);
  }, [open, rect, shown, value]);

  // Đổi từ khóa thì quay về đầu danh sách
  React.useEffect(() => {
    if (!open) return;
    jumpedRef.current = true; // đã gõ tìm kiếm: không nhảy về mục đang chọn nữa
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      const pop = document.getElementById(`combobox-pop-${id ?? 'x'}`);
      if (pop?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, id]);

  const choose = (opt: ComboOption) => {
    onChange(opt.value, opt);
    setOpen(false);
    setQuery('');
    btnRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = shown[active];
      if (opt) choose(opt);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-left text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          !selected && 'text-muted-foreground',
          className,
        )}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 opacity-50 transition-transform', open && 'rotate-180')} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && rect && (() => {
            // Bên dưới không đủ chỗ thì lật lên trên; danh sách cao tối đa 256px hoặc bằng khoảng trống còn lại
            const GAP = 4;
            const SEARCH_H = 37; // ô tìm kiếm h-9 + viền dưới
            const spaceBelow = window.innerHeight - rect.bottom - GAP - 8;
            const spaceAbove = rect.top - GAP - 8;
            const placeTop = spaceBelow < 200 && spaceAbove > spaceBelow;
            const listMax = Math.max(120, Math.min(256, (placeTop ? spaceAbove : spaceBelow) - SEARCH_H - 2));
            return (
            <motion.div
              id={`combobox-pop-${id ?? 'x'}`}
              className="fixed z-[60] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
              style={{
                ...(placeTop
                  ? { bottom: window.innerHeight - rect.top + GAP }
                  : { top: rect.bottom + GAP }),
                left: rect.left,
                width: rect.width,
                maxWidth: '92vw',
              }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <div className="flex h-9 items-center gap-2 border-b px-3">
                <Search className="h-4 w-4 shrink-0 opacity-50" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                    onSearch?.(e.target.value);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
                />
              </div>
              <ul
                ref={listRef}
                role="listbox"
                // overscroll-contain: cuộn tới cuối danh sách không kéo theo cả trang
                className="overflow-y-auto overscroll-contain p-1"
                style={{ maxHeight: listMax }}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              >
                {loading && (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">Đang tải…</li>
                )}
                {!loading && shown.length === 0 && (
                  <li className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</li>
                )}
                {!loading && start > 0 && (
                  <li aria-hidden style={{ height: start * ITEM_H }} />
                )}
                {!loading && visible.map((o, j) => {
                  const i = start + j;
                  return (
                    <li
                      key={o.value}
                      role="option"
                      aria-selected={o.value === value}
                      data-index={i}
                      className="h-11"
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(o)}
                        className={cn(
                          'flex h-full w-full items-center justify-between gap-3 rounded-sm px-2 text-left text-sm',
                          i === active && 'bg-accent text-accent-foreground',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate leading-5">{o.label}</span>
                          {o.hint && (
                            <span className="block truncate text-xs leading-4 text-muted-foreground">{o.hint}</span>
                          )}
                        </span>
                        {o.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    </li>
                  );
                })}
                {!loading && end < shown.length && (
                  <li aria-hidden style={{ height: (shown.length - end) * ITEM_H }} />
                )}
              </ul>
            </motion.div>
            );
          })()}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
