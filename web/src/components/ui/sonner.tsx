import type * as React from 'react';
import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '@/lib/theme';

/**
 * Toaster kiểu shadcn/ui trên nền Sonner: toast dùng đúng token màu của theme
 * (background/foreground/border) thay vì màu mặc định của Sonner.
 *
 * Không dùng `richColors` (xanh/đỏ mặc định của Sonner lệch bảng màu app);
 * thay vào đó style từng loại toast bằng cùng tông với Badge
 * (success/warning/info/destructive) để sáng/tối đều đồng bộ.
 */
const TOAST_TONES = {
  success:
    'group-[.toaster]:!border-emerald-500/30 group-[.toaster]:!bg-emerald-500/10 group-[.toaster]:!text-emerald-700 group-[.toaster]:dark:!text-emerald-400',
  error:
    'group-[.toaster]:!border-destructive/30 group-[.toaster]:!bg-destructive/10 group-[.toaster]:!text-destructive',
  warning:
    'group-[.toaster]:!border-amber-500/30 group-[.toaster]:!bg-amber-500/10 group-[.toaster]:!text-amber-700 group-[.toaster]:dark:!text-amber-400',
  info: 'group-[.toaster]:!border-sky-500/30 group-[.toaster]:!bg-sky-500/10 group-[.toaster]:!text-sky-700 group-[.toaster]:dark:!text-sky-400',
} as const;

export function Toaster({ ...props }: React.ComponentProps<typeof SonnerToaster>) {
  const { theme } = useTheme();
  return (
    <SonnerToaster
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          title: 'group-[.toast]:font-medium',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          closeButton:
            'group-[.toast]:bg-background group-[.toast]:text-muted-foreground group-[.toast]:border-border',
          ...TOAST_TONES,
        },
      }}
      {...props}
    />
  );
}
