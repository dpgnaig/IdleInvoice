import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogFooter } from './dialog';
import { Button } from './button';

/** Hộp xác nhận theo AlertDialog của shadcn/ui. */
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
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} className="max-w-md">
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Hủy
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'default'}
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
          {isBusy && <Loader2 className="animate-spin" />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
