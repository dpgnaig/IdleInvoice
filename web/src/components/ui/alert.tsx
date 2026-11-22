import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg+div]:translate-y-[-3px] [&:has(>svg)]:pl-10',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground [&>svg]:text-foreground',
        destructive:
          'border-destructive/50 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400 [&>svg]:text-destructive',
        success:
          'border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400',
        warning:
          'border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
        info: 'border-primary/40 bg-card text-foreground [&>svg]:text-primary',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

export const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
  ),
);
AlertDescription.displayName = 'AlertDescription';
