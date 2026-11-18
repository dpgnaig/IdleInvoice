import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, LogOut, Menu, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { ChangePasswordDialog } from '@/components/change-password-dialog';
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
          api.get('/customers', { params: { search: debounced, pageSize: 5 } }),
          api.get('/products', { params: { search: debounced, pageSize: 5 } }),
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
      <div className="flex h-16 items-center gap-3 px-4 lg:px-8">
        <button
          type="button"
          onClick={onMenu}
          className="btn-icon rounded-lg p-2 hover:bg-muted lg:hidden"
          aria-label="Mở menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-sm md:flex">
          {[{ label: 'Trang chủ', to: '/' }, ...crumbs.map((c, i) => ({
            label: LABELS[c] ?? c,
            to: `/${crumbs.slice(0, i + 1).join('/')}`,
          }))].map((c, i, arr) => (
            <span key={c.to} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(c.to)}
                className={cn(
                  'truncate rounded-md px-1 py-0.5 transition-colors hover:text-foreground',
                  i === arr.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {c.label}
              </button>
              {i < arr.length - 1 && <span className="text-muted-foreground/50">/</span>}
            </span>
          ))}
        </nav>

        <div className="relative ml-auto hidden w-full max-w-xs sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => results.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Tìm khách hàng, hàng hóa…"
            aria-label="Tìm khách hàng hoặc hàng hóa"
            className="input h-9 pl-8 pr-14 text-sm"
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
                className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border bg-card p-1 shadow-lift"
              >
                {results.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        navigate(r.kind === 'customer' ? '/customers' : '/products');
                        setQuery('');
                        setOpen(false);
                      }}
                    >
                      <span className="badge bg-muted text-[10px] uppercase text-muted-foreground">
                        {r.kind === 'customer' ? 'KH' : 'SP'}
                      </span>
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

        <button type="button" onClick={onCommand} className="btn-ghost h-9 px-2" aria-label="Mở bảng lệnh">
          <Search className="h-4 w-4 sm:hidden" />
          <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl K</span>
        </button>

        <div ref={userMenuRef} className="relative flex items-center gap-2 border-l pl-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">{user?.fullName}</p>
            <p className="text-xs text-muted-foreground">
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
                className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border bg-card p-1 shadow-lift"
              >
                <div className="border-b px-2.5 py-2">
                  <p className="truncate text-sm font-medium">{user?.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-muted"
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
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10"
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
