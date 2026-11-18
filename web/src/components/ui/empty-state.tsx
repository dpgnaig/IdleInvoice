import type * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({
  title,
  description,
  action,
  illustration,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  illustration?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      {illustration ?? <DefaultIllustration />}
      <h3 className="mt-5 text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

function DefaultIllustration() {
  const reduce = useReducedMotion();
  return (
    <motion.svg
      width="132"
      height="96"
      viewBox="0 0 132 96"
      fill="none"
      aria-hidden
      initial={reduce ? undefined : { opacity: 0, scale: 0.96 }}
      animate={reduce ? undefined : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <rect x="18" y="14" width="62" height="72" rx="10" className="fill-muted" />
      <rect x="30" y="28" width="38" height="5" rx="2.5" className="fill-muted-foreground/30" />
      <rect x="30" y="41" width="28" height="5" rx="2.5" className="fill-muted-foreground/20" />
      <rect x="30" y="54" width="34" height="5" rx="2.5" className="fill-muted-foreground/20" />
      <rect x="30" y="67" width="22" height="5" rx="2.5" className="fill-muted-foreground/20" />
      <circle cx="96" cy="58" r="22" className="fill-accent" />
      <path
        d="M88 58h16M96 50v16"
        className="stroke-primary"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </motion.svg>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('skeleton h-4 w-full', className)} style={style} aria-hidden />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap">
      <div className="border-b bg-muted/40 px-4 py-3">
        <Skeleton className="h-3 w-40" />
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b px-4 py-3.5 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3.5" style={{ width: `${60 + ((r + c) % 3) * 30}px` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
