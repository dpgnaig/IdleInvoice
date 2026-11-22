import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from '@/components/ui/sonner';
import { KeyRound, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, apiErrorMessage, tokenStore } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

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
      await api.post(endpoints.auth.changePassword, {
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
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label="Mật khẩu hiện tại" htmlFor="cur-pass" error={err('currentPassword')}>
          <Input
            id="cur-pass"
            type="password"
            autoComplete="current-password"
            {...form.register('currentPassword')}
            aria-invalid={Boolean(err('currentPassword'))}
          />
        </Field>
        <Field
          label="Mật khẩu mới"
          htmlFor="new-pass"
          error={err('newPassword')}
          hint={err('newPassword') ? undefined : 'Tối thiểu 8 ký tự, có chữ và số.'}
        >
          <Input
            id="new-pass"
            type="password"
            autoComplete="new-password"
            {...form.register('newPassword')}
            aria-invalid={Boolean(err('newPassword'))}
          />
        </Field>
        <Field label="Nhập lại mật khẩu mới" htmlFor="confirm-pass" error={err('confirmPassword')}>
          <Input
            id="confirm-pass"
            type="password"
            autoComplete="new-password"
            {...form.register('confirmPassword')}
            aria-invalid={Boolean(err('confirmPassword'))}
          />
        </Field>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Đổi mật khẩu
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
