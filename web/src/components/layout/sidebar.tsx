import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard,
  Upload,
  FileText,
  Users,
  Package,
  History,
  Shield,
  ChevronsLeft,
  ChevronsRight,
  Palette,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { AppearanceDialog } from '@/components/layout/appearance-dialog';

const NAV = [
  { to: '/', label: 'Tổng quan', icon: LayoutDashboard, end: true },
  { to: '/quotes/import', label: 'Nhập báo giá', icon: Upload },
  { to: '/invoices', label: 'Hóa đơn', icon: FileText },
  { to: '/customers', label: 'Khách hàng', icon: Users },
  { to: '/products', label: 'Sản phẩm', icon: Package },
  { to: '/quotes', label: 'Lịch sử báo giá', icon: History },
  { to: '/admin', label: 'Quản trị', icon: Shield, adminOnly: true },
];

export function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  // Ngăn kéo mobile luôn hiện đầy đủ nhãn (collapsed=false), dù sidebar desktop đang thu gọn.
  const renderContent = (collapsed: boolean) => (
    <div className="flex h-full flex-col">
      <div className={cn('flex items-center gap-2.5 px-4 py-5', collapsed && 'justify-center px-2')}>
        <img
          src="/logo.png"
          alt="QuoteFlow"
          className="animate__animated animate__rotateIn h-9 w-9 shrink-0 rounded-lg object-contain"
        />
        {!collapsed && (
          <div className="min-w-0">
            <p className="flex truncate bg-gradient-to-r from-primary via-fuchsia-500 to-amber-400 bg-clip-text text-sm font-brand font-black tracking-tight text-transparent">
              {'QuoteFlow'.split('').map((ch, i) => (
                <span
                  key={i}
                  className="animate__animated animate__fadeIn inline-block"
                  style={{ animationDelay: `${0.4 + i * 0.05}s` }}
                >
                  {ch}
                </span>
              ))}
            </p>
            <p className="truncate text-xs text-muted-foreground animate__animated animate__fadeIn animate__delay-1s">
              Lập hóa đơn từ báo giá
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2" aria-label="Điều hướng chính">
        {NAV.filter((n) => !n.adminOnly || user?.role === 'admin').map((item) => {
          const Icon = item.icon;
          // Mục khớp dài nhất thắng (vd /quotes/import không tô sáng /quotes)
          const matches = (to: string) =>
            location.pathname === to || location.pathname.startsWith(`${to}/`);
          const longer = NAV.some(
            (n) => n.to.length > item.to.length && n.to.startsWith(item.to) && matches(n.to),
          );
          const active = item.end ? location.pathname === item.to : matches(item.to) && !longer;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onMobileClose}
              title={collapsed ? item.label : undefined}
              className={cn(
                'group relative flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                active && 'bg-accent text-accent-foreground',
                collapsed && 'justify-center px-2',
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 -z-10 rounded-md bg-accent"
                  transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                />
              )}
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="grid gap-1 border-t p-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setAppearanceOpen(true)}
          title={collapsed ? 'Giao diện' : undefined}
          className={cn('w-full justify-start px-2.5 font-medium text-muted-foreground', collapsed && 'justify-center px-2')}
        >
          <Palette />
          {!collapsed && <span>Giao diện</span>}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void logout()}
          className={cn('w-full justify-start px-2.5 font-medium text-muted-foreground', collapsed && 'justify-center px-2')}
        >
          <LogOut />
          {!collapsed && <span>Đăng xuất</span>}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onToggle}
          className={cn(
            'hidden w-full justify-start px-2.5 font-medium text-muted-foreground lg:flex',
            collapsed && 'justify-center px-2',
          )}
          aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
        >
          {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          {!collapsed && <span>Thu gọn</span>}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <AppearanceDialog open={appearanceOpen} onOpenChange={setAppearanceOpen} />
      <motion.aside
        className="sticky top-0 hidden h-screen shrink-0 border-r bg-card lg:block"
        animate={{ width: collapsed ? 76 : 248 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      >
        {renderContent(collapsed)}
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onMobileClose}
            />
            <motion.aside
              className="fixed left-0 top-0 z-50 h-screen w-64 border-r bg-card lg:hidden"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            >
              {renderContent(false)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
