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
  ReceiptText,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

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
  const { theme, toggle } = useTheme();
  const location = useLocation();

  const content = (
    <div className="flex h-full flex-col">
      <div className={cn('flex items-center gap-2.5 px-4 py-5', collapsed && 'justify-center px-2')}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <ReceiptText className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">IdleInvoice</p>
            <p className="truncate text-xs text-muted-foreground">Lập hóa đơn từ báo giá</p>
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
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                active && 'bg-accent text-accent-foreground',
                collapsed && 'justify-center px-2',
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 -z-10 rounded-xl bg-accent"
                  transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                />
              )}
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="space-y-1 border-t p-2">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted',
            collapsed && 'justify-center px-2',
          )}
        >
          {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          {!collapsed && <span>{theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}</span>}
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted',
            collapsed && 'justify-center px-2',
          )}
        >
          <LogOut className="h-[18px] w-[18px]" />
          {!collapsed && <span>Đăng xuất</span>}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'hidden w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted lg:flex',
            collapsed && 'justify-center px-2',
          )}
          aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
        >
          {collapsed ? <ChevronsRight className="h-[18px] w-[18px]" /> : <ChevronsLeft className="h-[18px] w-[18px]" />}
          {!collapsed && <span>Thu gọn</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <motion.aside
        className="sticky top-0 hidden h-screen shrink-0 border-r bg-card lg:block"
        animate={{ width: collapsed ? 76 : 248 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      >
        {content}
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
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
