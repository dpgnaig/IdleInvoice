import type * as React from 'react';
import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '@/lib/theme';

/**
 * Toaster kiểu shadcn/ui trên nền Sonner: toast dùng đúng token màu của theme
 * (background/foreground/border) thay vì màu mặc định của Sonner.
 * Đặt một lần ở gốc ứng dụng để mọi trang, kể cả đăng nhập, đều có thông báo.
 */
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
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}
