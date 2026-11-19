import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard, Upload, FileText, Users, Package, History, Shield, Search,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useDebounced } from '@/lib/use-debounced';

const ITEMS = [
  { to: '/', label: 'Tổng quan', icon: LayoutDashboard, adminOnly: false },
  { to: '/quotes/import', label: 'Nhập báo giá', icon: Upload, adminOnly: false },
  { to: '/invoices', label: 'Hóa đơn', icon: FileText, adminOnly: false },
  { to: '/customers', label: 'Khách hàng', icon: Users, adminOnly: false },
  { to: '/products', label: 'Sản phẩm', icon: Package, adminOnly: false },
  { to: '/quotes', label: 'Lịch sử báo giá', icon: History, adminOnly: false },
  { to: '/admin', label: 'Quản trị', icon: Shield, adminOnly: true },
];

interface Entity {
  kind: 'KH' | 'SP';
  id: number;
  label: string;
  hint: string;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = React.useState('');
  const [entities, setEntities] = React.useState<Entity[]>([]);
  const [active, setActive] = React.useState(0);
  const debounced = useDebounced(query.trim(), 250);

  const pages = React.useMemo(
    () =>
      ITEMS.filter((i) => !i.adminOnly || user?.role === 'admin').filter((i) =>
        i.label.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, user?.role],
  );

  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setEntities([]);
      setActive(0);
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (debounced.length < 2) {
      setEntities([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [c, p] = await Promise.all([
          api.get('/customers', { params: { search: debounced, pageSize: 5 } }),
          api.get('/products', { params: { search: debounced, pageSize: 5 } }),
        ]);
        if (cancelled) return;
        setEntities([
          ...c.data.data.map((x: { id: number; name: string; taxCode: string }) => ({
            kind: 'KH' as const, id: x.id, label: x.name, hint: `MST ${x.taxCode}`,
          })),
          ...p.data.data.map((x: { id: number; name: string; code: string }) => ({
            kind: 'SP' as const, id: x.id, label: x.name, hint: `Mã ${x.code}`,
          })),
        ]);
      } catch {
        if (!cancelled) setEntities([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const total = pages.length + entities.length;
  const go = (index: number) => {
    if (index < pages.length) {
      navigate(pages[index]!.to);
    } else {
      const e = entities[index - pages.length]!;
      navigate(e.kind === 'KH' ? '/customers' : '/products');
    }
    onOpenChange(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[14vh]">
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            role="dialog" aria-modal="true" aria-label="Bảng lệnh"
            className="relative z-10 w-full max-w-xl overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: 0.16 }}
          >
            <div className="flex h-11 items-center gap-2 border-b px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, total - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  if (e.key === 'Enter' && total > 0) { e.preventDefault(); go(active); }
                }}
                placeholder="Chuyển trang hoặc tìm khách/hàng…"
                aria-label="Tìm lệnh hoặc dữ liệu"
                className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
            </div>
            <ul className="max-h-[52vh] overflow-auto p-1">
              {pages.map((p, i) => {
                const Icon = p.icon;
                return (
                  <li key={p.to}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(i)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                        i === active && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span>Đi tới: {p.label}</span>
                    </button>
                  </li>
                );
              })}
              {entities.length > 0 && (
                <li className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Kết quả tìm kiếm
                </li>
              )}
              {entities.map((e, i) => {
                const index = pages.length + i;
                return (
                  <li key={`${e.kind}-${e.id}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(index)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                        index === active && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <Badge variant="secondary" className="text-[10px]">{e.kind}</Badge>
                      <span className="min-w-0 flex-1 truncate text-left">{e.label}</span>
                      <span className="truncate text-xs text-muted-foreground">{e.hint}</span>
                    </button>
                  </li>
                );
              })}
              {total === 0 && (
                <li className="px-2 py-6 text-center text-sm text-muted-foreground">Không có kết quả</li>
              )}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
