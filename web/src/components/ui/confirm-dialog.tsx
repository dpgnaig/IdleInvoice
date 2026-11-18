import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from './dialog';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Xác nhận',
  destructive,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const isBusy = busy || loading;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} className="max-w-md">
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={() => onOpenChange(false)}>
          Hủy
        </button>
        <button
          type="button"
          className={destructive ? 'btn-destructive' : 'btn-primary'}
          disabled={isBusy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {isBusy ? 'Đang xử lý…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
