import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

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
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();

  const selected = options.find((o) => o.value === value);

  const filtered = React.useMemo(() => {
    if (onSearch) return options; // lọc phía server
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    );
  }, [options, query, onSearch]);

  React.useEffect(() => {
    if (open) setRect(btnRef.current?.getBoundingClientRect() ?? null);
  }, [open]);

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
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[active];
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
          'input flex w-full items-center justify-between gap-2 text-left',
          !selected && 'text-muted-foreground',
          className,
        )}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              id={`combobox-pop-${id ?? 'x'}`}
              className="fixed z-[60] overflow-hidden rounded-xl border bg-card shadow-lift"
              style={{ top: rect.bottom + 6, left: rect.left, width: rect.width, maxWidth: '92vw' }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -2 }}
              transition={{ duration: 0.14 }}
            >
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
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
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <ul role="listbox" className="max-h-64 overflow-auto p-1">
                {loading && (
                  <li className="px-3 py-2 text-sm text-muted-foreground">Đang tải…</li>
                )}
                {!loading && filtered.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</li>
                )}
                {filtered.map((o, i) => (
                  <li key={o.value} role="option" aria-selected={o.value === value}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(o)}
                      className={cn(
                        'flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm',
                        i === active && 'bg-muted',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{o.label}</span>
                        {o.hint && (
                          <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>
                        )}
                      </span>
                      {o.value === value && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
