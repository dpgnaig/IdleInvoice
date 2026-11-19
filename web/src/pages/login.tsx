import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Loader2, ReceiptText } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const [registrationMode, setRegistrationMode] = useState<string>('approval');
  const [setupPending, setSetupPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    api
      .get<{ setupCompleted: boolean }>('/setup/status')
      .then((r) => setSetupPending(!r.data.setupCompleted))
      .catch(() => setSetupPending(false));
  }, []);

  const onSubmit = async (values: FormValues) => {
    setServerError('');
    try {
      const user = await login(values.email, values.password);
      toast.success(`Xin chào, ${user.fullName}`);
      navigate('/', { replace: true });
    } catch (err) {
      setServerError(apiErrorMessage(err));
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
            <ReceiptText className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">IdleInvoice</span>
        </div>
        <div className="relative z-10">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="max-w-md text-3xl font-semibold leading-tight"
          >
            Lập hóa đơn từ báo giá, không còn nhập tay từng dòng.
          </motion.h1>
          <p className="mt-4 max-w-md text-sm text-primary-foreground/80">
            Tải báo giá PDF hoặc Excel, hệ thống đọc dữ liệu, ghép khách hàng và mã hàng trong
            danh mục, rồi xuất file Excel đúng mẫu để import lên phần mềm hóa đơn.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/60">
          Dữ liệu lưu cục bộ trên máy chủ của bạn.
        </p>
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 right-10 h-[320px] w-[320px] rounded-full bg-white/10 blur-2xl"
        />
      </div>

      <div className="flex items-center justify-center px-5 py-12">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ReceiptText className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold">IdleInvoice</span>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl tracking-tight">Đăng nhập</CardTitle>
              <CardDescription>Dùng tài khoản do quản trị viên cấp.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
                <Field label="Email" htmlFor="email" error={errors.email?.message}>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    aria-invalid={Boolean(errors.email)}
                    {...register('email')}
                  />
                </Field>
                <Field label="Mật khẩu" htmlFor="password" error={errors.password?.message}>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    aria-invalid={Boolean(errors.password)}
                    {...register('password')}
                  />
                </Field>

                {serverError && (
                  <motion.p
                    role="alert"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {serverError}
                  </motion.p>
                )}

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="animate-spin" />}
                  Đăng nhập
                </Button>
              </form>
            </CardContent>
            <CardFooter className="flex-col items-start gap-2 text-sm text-muted-foreground">
              {setupPending && (
                <p>
                  Hệ thống chưa thiết lập.{' '}
                  <Link to="/setup" className="font-medium text-primary hover:underline">
                    Chạy thiết lập ban đầu
                  </Link>
                </p>
              )}
              {registrationMode === 'closed' ? (
                <p>Hệ thống không mở đăng ký. Liên hệ quản trị viên để được cấp tài khoản.</p>
              ) : (
                <p>
                  Chưa có tài khoản?{' '}
                  <Link to="/register" className="font-medium text-primary hover:underline">
                    Đăng ký
                  </Link>
                </p>
              )}
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
