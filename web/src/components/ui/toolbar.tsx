import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from './input';

/**
 * Thanh công cụ của bảng dùng cỡ "sm" (h-8) cho mọi control: SearchInput,
 * SegmentedControl, Button size="sm" — để cả hàng thẳng một đường.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-8 pl-8 pr-8"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Xóa tìm kiếm"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: ReactNode;
}

/** Nhóm nút lọc một lựa chọn, giao diện TabsList/TabsTrigger của shadcn/ui, cao h-8. */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentOption<V>[];
  value: V;
  onChange: (v: V) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-muted p-0.5 text-muted-foreground"
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-state={active ? 'active' : 'inactive'}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5',
              active ? 'bg-background text-foreground shadow' : 'hover:text-foreground',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
