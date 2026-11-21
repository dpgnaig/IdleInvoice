import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Dialog giao diện shadcn/ui (DialogContent/DialogHeader/DialogTitle/DialogDescription),
 * giữ API cũ `open/onOpenChange/title/description` để các nơi gọi không phải đổi.
 */
export function Dialog({
  open,
  onOpenChange,
  children,
  className,
  title,
  description,
  hideClose = false,
  titleHidden = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
  /** Ẩn nút X — dùng khi nội dung đã có cách đóng riêng (vd. phím ESC của bảng lệnh). */
  hideClose?: boolean;
  /** Chỉ đọc `title` cho trình đọc màn hình, không hiện tiêu đề trên giao diện. */
  titleHidden?: boolean;
}) {
  const reduce = useReducedMotion();
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onOpenChange]);

  // Render vào body: header dùng `backdrop-blur` nên tạo containing block, nếu để
  // dialog nằm trong header thì lớp phủ `fixed` sẽ bị nhốt vào khung header.
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-black/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'relative z-10 grid w-full max-w-lg gap-4 rounded-t-lg border bg-background p-6 shadow-lg sm:rounded-lg',
              className,
            )}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
          >
            {(title || description) && (
              <div className={cn('flex flex-col space-y-1.5 pr-6 text-left', titleHidden && 'sr-only')}>
                {title && <h2 className="text-lg font-semibold leading-none tracking-tight">{title}</h2>}
                {description && <p className="text-sm text-muted-foreground">{description}</p>}
              </div>
            )}
            <div>{children}</div>
            {!hideClose && (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Hàng nút cuối dialog (DialogFooter của shadcn). */
export function DialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end', className)}>{children}</div>
  );
}
