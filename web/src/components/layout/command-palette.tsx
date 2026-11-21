import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Upload, FileText, Users, Package, History, Shield,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { Badge } from '@/components/ui/badge';
import { useDebounced } from '@/lib/use-debounced';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';

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
  const [searching, setSearching] = React.useState(false);
  const debounced = useDebounced(query.trim(), 250);

  const pages = React.useMemo(
    () =>
      ITEMS.filter((i) => !i.adminOnly || user?.role === 'admin').filter((i) =>
        i.label.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query, user?.role],
  );

  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setEntities([]);
      setSearching(false);
    }
  }, [open]);

  React.useEffect(() => {
    if (debounced.length < 2) {
      setEntities([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      try {
        const [c, p] = await Promise.all([
          api.get(endpoints.customers.list, { params: { search: debounced, pageSize: 5 } }),
          api.get(endpoints.products.list, { params: { search: debounced, pageSize: 5 } }),
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
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const go = (to: string) => {
    navigate(to);
    onOpenChange(false);
  };

  const hasResults = pages.length > 0 || entities.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-xl gap-0 p-0"
      // Lọc trang phía client và kết quả khách/hàng phía server: để cmdk tự lọc
      // sẽ ẩn mất các dòng server trả về mà không chứa đúng chuỗi đang gõ.
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Chuyển trang hoặc tìm khách/hàng…"
        aria-label="Tìm lệnh hoặc dữ liệu"
      >
        <CommandShortcut className="pr-2">ESC</CommandShortcut>
      </CommandInput>
      <CommandList>
        {searching && <CommandLoading>Đang tìm…</CommandLoading>}
        {!hasResults && !searching && <CommandEmpty>Không có kết quả</CommandEmpty>}

        {pages.length > 0 && (
          <CommandGroup heading="Đi tới">
            {pages.map((p) => {
              const Icon = p.icon;
              return (
                <CommandItem key={p.to} value={`page-${p.to}`} onSelect={() => go(p.to)}>
                  <Icon className="text-muted-foreground" />
                  <span>{p.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {entities.length > 0 && (
          <>
            {pages.length > 0 && <CommandSeparator />}
            <CommandGroup heading="Kết quả tìm kiếm">
              {entities.map((e) => (
                <CommandItem
                  key={`${e.kind}-${e.id}`}
                  value={`${e.kind}-${e.id}`}
                  onSelect={() => go(e.kind === 'KH' ? '/customers' : '/products')}
                >
                  <Badge variant="secondary" className="text-[10px]">{e.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate text-left">{e.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{e.hint}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
