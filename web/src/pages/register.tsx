import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, ReceiptText } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';

const schema = z
  .object({
    fullName: z.string().min(2, 'Vui lòng nhập họ tên'),
    email: z.string().email('Email không hợp lệ'),
    password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Mật khẩu nhập lại không khớp', path: ['confirm'] })
  .refine((v) => /[A-Za-zÀ-ỹ]/.test(v.password), { message: 'Mật khẩu phải có chữ cái', path: ['password'] })
  .refine((v) => /\d/.test(v.password), { message: 'Mật khẩu phải có chữ số', path: ['password'] });

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const [done, setDone] = useState<{ status: string; message: string } | null>(null);
  const [serverError, setServerError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setServerError('');
    try {
      const { data } = await api.post('/auth/register', {
        fullName: values.fullName,
        email: values.email,
        password: values.password,
      });
      setDone(data);
      toast.success('Đăng ký thành công');
    } catch (err) {
      setServerError(apiErrorMessage(err));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ReceiptText className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">IdleInvoice</span>
        </div>

        {done ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-surface p-6">
            <CheckCircle2 className="h-9 w-9 text-primary" />
            <h2 className="mt-3 text-lg font-semibold">
              {done.status === 'pending' ? 'Đang chờ quản trị viên duyệt' : 'Đăng ký thành công'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{done.message}</p>
            <Link to="/login" className="btn-primary mt-6 w-full">Về trang đăng nhập</Link>
          </motion.div>
        ) : (
          <>
            <h2 className="text-2xl font-semibold tracking-tight">Đăng ký tài khoản</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tài khoản mới có thể cần quản trị viên duyệt trước khi đăng nhập.
            </p>
            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
              <div>
                <label htmlFor="fullName" className="label">Họ và tên</label>
                <input id="fullName" className="input" autoComplete="name" {...register('fullName')} />
                {errors.fullName && <p className="field-error">{errors.fullName.message}</p>}
              </div>
              <div>
                <label htmlFor="email" className="label">Email</label>
                <input id="email" type="email" className="input" autoComplete="username" {...register('email')} />
                {errors.email && <p className="field-error">{errors.email.message}</p>}
              </div>
              <div>
                <label htmlFor="password" className="label">Mật khẩu</label>
                <input id="password" type="password" className="input" autoComplete="new-password" {...register('password')} />
                <p className="mt-1 text-xs text-muted-foreground">Tối thiểu 8 ký tự, có chữ và số.</p>
                {errors.password && <p className="field-error">{errors.password.message}</p>}
              </div>
              <div>
                <label htmlFor="confirm" className="label">Nhập lại mật khẩu</label>
                <input id="confirm" type="password" className="input" autoComplete="new-password" {...register('confirm')} />
                {errors.confirm && <p className="field-error">{errors.confirm.message}</p>}
              </div>
              {serverError && (
                <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {serverError}
                </p>
              )}
              <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Đăng ký
              </button>
            </form>
            <p className="mt-6 text-sm text-muted-foreground">
              Đã có tài khoản?{' '}
              <Link to="/login" className="font-medium text-primary hover:underline">Đăng nhập</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
