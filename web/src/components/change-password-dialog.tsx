import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { KeyRound, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, apiErrorMessage, tokenStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Dialog } from '@/components/ui/dialog';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
    newPassword: z
      .string()
      .min(8, 'Tối thiểu 8 ký tự')
      .regex(/[A-Za-z]/, 'Cần ít nhất một chữ cái')
      .regex(/\d/, 'Cần ít nhất một chữ số'),
    confirmPassword: z.string().min(1, 'Nhập lại mật khẩu mới'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Mật khẩu nhập lại không khớp',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (open) form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      onOpenChange(false);
      toast.success('Đã đổi mật khẩu. Vui lòng đăng nhập lại.');
      // Server đã thu hồi toàn bộ phiên và xóa cookie refresh
      tokenStore.set(null);
      await logout();
      navigate('/login', { replace: true });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  });

  const err = (k: keyof FormValues) => form.formState.errors[k]?.message;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Đổi mật khẩu"
      description="Sau khi đổi, tất cả phiên đăng nhập sẽ bị đăng xuất."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="cur-pass" className="label">Mật khẩu hiện tại</label>
          <input
            id="cur-pass"
            type="password"
            autoComplete="current-password"
            className="input"
            {...form.register('currentPassword')}
            aria-invalid={Boolean(err('currentPassword'))}
          />
          {err('currentPassword') && <p className="mt-1 text-xs text-destructive">{err('currentPassword')}</p>}
        </div>
        <div>
          <label htmlFor="new-pass" className="label">Mật khẩu mới</label>
          <input
            id="new-pass"
            type="password"
            autoComplete="new-password"
            className="input"
            {...form.register('newPassword')}
            aria-invalid={Boolean(err('newPassword'))}
          />
          {err('newPassword') ? (
            <p className="mt-1 text-xs text-destructive">{err('newPassword')}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Tối thiểu 8 ký tự, có chữ và số.</p>
          )}
        </div>
        <div>
          <label htmlFor="confirm-pass" className="label">Nhập lại mật khẩu mới</label>
          <input
            id="confirm-pass"
            type="password"
            autoComplete="new-password"
            className="input"
            {...form.register('confirmPassword')}
            aria-invalid={Boolean(err('confirmPassword'))}
          />
          {err('confirmPassword') && <p className="mt-1 text-xs text-destructive">{err('confirmPassword')}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-outline" onClick={() => onOpenChange(false)}>
            Hủy
          </button>
          <button type="submit" className="btn-primary" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            Đổi mật khẩu
          </button>
        </div>
      </form>
    </Dialog>
  );
}
