import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, LogOut, Menu, Search, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { ChangePasswordDialog } from '@/components/change-password-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDebounced } from '@/lib/use-debounced';

const LABELS: Record<string, string> = {
  '': 'Tổng quan',
  quotes: 'Báo giá',
  import: 'Nhập báo giá',
  invoices: 'Hóa đơn',
  customers: 'Khách hàng',
  products: 'Sản phẩm',
  admin: 'Quản trị',
  setup: 'Thiết lập',
};

interface SearchResult {
  kind: 'customer' | 'product';
  id: number;
  title: string;
  subtitle: string;
}

export function Header({ onMenu, onCommand }: { onMenu: () => void; onCommand: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(query.trim(), 300);

  useEffect(() => {
    if (!userMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setUserMenu(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenu]);

  const crumbs = location.pathname.split('/').filter(Boolean);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [c, p] = await Promise.all([
          api.get(endpoints.customers.list, { params: { search: debounced, pageSize: 5 } }),
          api.get(endpoints.products.list, { params: { search: debounced, pageSize: 5 } }),
        ]);
        if (cancelled) return;
        const items: SearchResult[] = [
          ...c.data.data.map((x: { id: number; name: string; taxCode: string }) => ({
            kind: 'customer' as const,
            id: x.id,
            title: x.name,
            subtitle: `MST ${x.taxCode}`,
          })),
          ...p.data.data.map((x: { id: number; name: string; code: string }) => ({
            kind: 'product' as const,
            id: x.id,
            title: x.name,
            subtitle: `Mã ${x.code}`,
          })),
        ];
        setResults(items);
        setOpen(true);
      } catch {
        if (!cancelled) setResults([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
        <Button type="button" variant="ghost" size="icon" onClick={onMenu} className="lg:hidden" aria-label="Mở menu">
          <Menu />
        </Button>

        <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
          <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {[{ label: 'Trang chủ', to: '/' }, ...crumbs.map((c, i) => ({
              label: LABELS[c] ?? c,
              to: `/${crumbs.slice(0, i + 1).join('/')}`,
            }))].map((c, i, arr) => (
              <li key={c.to} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => navigate(c.to)}
                  aria-current={i === arr.length - 1 ? 'page' : undefined}
                  className={cn(
                    'truncate transition-colors hover:text-foreground',
                    i === arr.length - 1 && 'font-normal text-foreground',
                  )}
                >
                  {c.label}
                </button>
                {i < arr.length - 1 && <ChevronRight className="h-3.5 w-3.5" />}
              </li>
            ))}
          </ol>
        </nav>

        <div className="relative ml-auto hidden w-full max-w-xs sm:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => results.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Tìm khách hàng, hàng hóa…"
            aria-label="Tìm khách hàng hoặc hàng hóa"
            className="h-9 pl-8 pr-14"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
          <AnimatePresence>
            {open && results.length > 0 && (
              <motion.ul
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              >
                {results.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        navigate(r.kind === 'customer' ? '/customers' : '/products');
                        setQuery('');
                        setOpen(false);
                      }}
                    >
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {r.kind === 'customer' ? 'KH' : 'SP'}
                      </Badge>
                      <span className="min-w-0">
                        <span className="block truncate">{r.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        <Button type="button" variant="ghost" onClick={onCommand} className="px-2" aria-label="Mở bảng lệnh">
          <Search className="sm:hidden" />
          <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl K</span>
        </Button>

        <div ref={userMenuRef} className="relative flex items-center gap-2 border-l pl-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">{user?.fullName}</p>
            <p className="text-xs leading-tight text-muted-foreground">
              {user?.role === 'admin' ? 'Quản trị viên' : 'Kế toán'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUserMenu((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={userMenu}
            aria-label="Tài khoản"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary transition-colors hover:bg-primary/15"
          >
            {user?.fullName?.slice(0, 1).toUpperCase() ?? '?'}
          </button>
          <AnimatePresence>
            {userMenu && (
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              >
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-semibold">{user?.fullName}</p>
                  <p className="truncate text-xs font-normal text-muted-foreground">{user?.email}</p>
                </div>
                <div className="-mx-1 my-1 h-px bg-muted" />
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    setUserMenu(false);
                    setPwOpen(true);
                  }}
                >
                  <KeyRound className="h-4 w-4" /> Đổi mật khẩu
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    setUserMenu(false);
                    void logout();
                  }}
                >
                  <LogOut className="h-4 w-4" /> Đăng xuất
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </header>
  );
}
