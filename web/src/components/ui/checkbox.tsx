import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Checkbox giao diện shadcn/ui trên nền <input type="checkbox"> native
 * (giữ nguyên onChange/checked và hành vi form, không cần Radix).
 */
const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(({ className, ...props }, ref) => (
  <span className={cn('relative inline-flex h-4 w-4 shrink-0 align-middle', className)}>
    <input
      ref={ref}
      type="checkbox"
      className="peer h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-sm border border-primary shadow-sm transition-colors checked:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      {...props}
    />
    <Check
      className="pointer-events-none absolute inset-0 m-auto hidden h-3 w-3 text-primary-foreground peer-checked:block"
      strokeWidth={3}
      aria-hidden
    />
  </span>
));
Checkbox.displayName = 'Checkbox';

export { Checkbox };
