import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (v: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const display = (d: Date | null) => (d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '');

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const PANEL_W = 292;

/**
 * DatePicker kiểu shadcn/ui: nút mở popover lịch, chọn ngày theo tuần bắt đầu Thứ 2.
 * Không phụ thuộc Radix; popover render qua portal nên không bị cắt bởi khung cuộn.
 */
export function DatePicker({
  id,
  value,
  onChange,
  placeholder = 'Chọn ngày',
  disabled,
  className,
}: {
  id?: string;
  /** yyyy-mm-dd, hoặc chuỗi rỗng. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = parseIso(value);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [view, setView] = useState(() => {
    const base = selected ?? new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const btnRef = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const today = new Date();
  const panelId = `datepicker-pop-${id ?? 'x'}`;

  const openPanel = () => {
    const base = selected ?? new Date();
    setView({ y: base.getFullYear(), m: base.getMonth() });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        if (r.bottom < 0 || r.top > window.innerHeight) setOpen(false);
        else setRect(r);
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (document.getElementById(panelId)?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, panelId]);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const out: Array<Date | null> = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(view.y, view.m, d));
    return out;
  }, [view]);

  const shiftMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  const choose = (d: Date) => {
    onChange(toIso(d));
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-left text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? display(selected) : placeholder}
        </span>
        <CalendarDays className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && rect && (() => {
            const GAP = 4;
            const PANEL_H = 322;
            const spaceBelow = window.innerHeight - rect.bottom - GAP - 8;
            const placeTop = spaceBelow < PANEL_H && rect.top > spaceBelow;
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_W - 8));
            return (
              <motion.div
                id={panelId}
                role="dialog"
                aria-label="Chọn ngày"
                className="fixed z-[60] rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
                style={{
                  width: PANEL_W,
                  left,
                  ...(placeTop
                    ? { bottom: window.innerHeight - rect.top + GAP }
                    : { top: rect.bottom + GAP }),
                }}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Tháng trước"
                    onClick={() => shiftMonth(-1)}
                  >
                    <ChevronLeft />
                  </Button>
                  <span className="text-sm font-medium">
                    Tháng {view.m + 1} / {view.y}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Tháng sau"
                    onClick={() => shiftMonth(1)}
                  >
                    <ChevronRight />
                  </Button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
                  {WEEKDAYS.map((w) => (
                    <span key={w} className="py-1">{w}</span>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {cells.map((d, i) => {
                    if (!d) return <span key={`blank-${i}`} />;
                    const isSelected = Boolean(selected && sameDay(d, selected));
                    const isToday = sameDay(d, today);
                    return (
                      <button
                        key={toIso(d)}
                        type="button"
                        onClick={() => choose(d)}
                        aria-pressed={isSelected}
                        className={cn(
                          'h-8 rounded-md text-sm tabular-nums transition-colors',
                          isSelected
                            ? 'bg-primary font-medium text-primary-foreground hover:bg-primary/90'
                            : 'hover:bg-accent hover:text-accent-foreground',
                          !isSelected && isToday && 'ring-1 ring-primary/60',
                        )}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 flex items-center justify-between border-t pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => { onChange(''); setOpen(false); }}
                  >
                    Xóa
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => choose(today)}
                  >
                    Hôm nay
                  </Button>
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
