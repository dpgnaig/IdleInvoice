import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Select native giao diện shadcn/ui (cùng chiều cao/viền với Input).
 * `className` áp cho khung bao (đặt độ rộng), `selectClassName` cho chính thẻ select.
 */
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { selectClassName?: string }
>(({ className, selectClassName, children, ...props }, ref) => (
  <div className={cn('relative w-full', className)}>
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full appearance-none rounded-md border border-input bg-background py-1 pl-3 pr-8 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        selectClassName,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50"
      aria-hidden
    />
  </div>
));
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
