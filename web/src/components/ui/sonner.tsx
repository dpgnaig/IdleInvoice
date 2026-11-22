import type * as React from 'react';
import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '@/lib/theme';

/**
 * Toaster kiểu shadcn/ui trên nền Sonner: toast dùng đúng token màu của theme
 * (background/foreground/border) thay vì màu mặc định của Sonner.
 *
 * Không dùng `richColors` (xanh/đỏ mặc định của Sonner lệch bảng màu app);
 * thay vào đó style từng loại toast bằng nền ĐẶC màu pastel (không phải lớp phủ
 * mờ 10% khiến toast nhìn trong suốt, lẫn vào nội dung phía sau) theo đúng tông
 * success/warning/info/destructive, sáng/tối đều đồng bộ.
 */
const TOAST_TONES = {
  success:
    'group-[.toaster]:!border-emerald-500/30 group-[.toaster]:!bg-emerald-50 group-[.toaster]:!text-emerald-700 group-[.toaster]:dark:!bg-emerald-950 group-[.toaster]:dark:!text-emerald-400',
  error:
    'group-[.toaster]:!border-destructive/30 group-[.toaster]:!bg-red-50 group-[.toaster]:!text-destructive group-[.toaster]:dark:!bg-red-950',
  warning:
    'group-[.toaster]:!border-amber-500/30 group-[.toaster]:!bg-amber-50 group-[.toaster]:!text-amber-700 group-[.toaster]:dark:!bg-amber-950 group-[.toaster]:dark:!text-amber-400',
  info: 'group-[.toaster]:!border-sky-500/30 group-[.toaster]:!bg-sky-50 group-[.toaster]:!text-sky-700 group-[.toaster]:dark:!bg-sky-950 group-[.toaster]:dark:!text-sky-400',
} as const;

export function Toaster({ ...props }: React.ComponentProps<typeof SonnerToaster>) {
  const { theme } = useTheme();
  return (
    <SonnerToaster
      theme={theme}
      className="toaster group"
      toastOptions={{
        duration: 4000,
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
