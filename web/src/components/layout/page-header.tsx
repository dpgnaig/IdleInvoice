import type { ReactNode } from 'react';

/**
 * Tiêu đề trang gọn một hàng: tên trang + mô tả 1 dòng bên trái, nút chức năng bên phải.
 * Nút dùng <Button> mặc định (h-9) để hàng nút luôn thẳng.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground" title={description}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className={`mt-2 text-2xl font-semibold tracking-tight ${accent ? 'text-primary' : ''}`}>
            {value}
          </div>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
