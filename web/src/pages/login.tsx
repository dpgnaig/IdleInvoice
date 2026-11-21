import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const schema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

type FormValues = z.infer<typeof schema>;

const FEATURES = [
  {
    icon: FileSpreadsheet,
    title: 'Đọc PDF, Excel, Word',
    text: 'Tải báo giá lên, hệ thống tự bóc tách bảng hàng hóa.',
  },
  {
    icon: Sparkles,
    title: 'AI đối chiếu từng dòng',
    text: 'Ghép khách hàng và mã hàng trong danh mục, cảnh báo chỗ lệch.',
  },
  {
    icon: ShieldCheck,
    title: 'Dữ liệu là của bạn',
    text: 'Mọi thứ lưu cục bộ trên máy chủ, không gửi ra ngoài ngoài ý muốn.',
  },
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const [errorShake, setErrorShake] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [setupPending, setSetupPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    api
      .get<{ setupCompleted: boolean }>(endpoints.setup.status)
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
      setErrorShake((n) => n + 1);
    }
  };

  return (
    <div className="relative grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      {/* Cột trái: giới thiệu sản phẩm */}
      <aside className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div
          aria-hidden
          className="animate__animated animate__fadeIn animate__slower pointer-events-none absolute -right-28 -top-28 h-[460px] w-[460px] rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden
          className="animate__animated animate__fadeIn animate__slower animate__delay-1s pointer-events-none absolute -bottom-40 left-1/4 h-[360px] w-[360px] rounded-full bg-white/10 blur-2xl"
        />

        <div className="animate__animated animate__fadeInDown relative z-10 flex items-center gap-3">
          <img
            src="/logo.png"
            alt="IdleInvoice"
            className="h-11 w-11 rounded-xl bg-white/10 object-contain p-1 ring-1 ring-white/20"
          />
          <span className="text-lg font-semibold tracking-tight">IdleInvoice</span>
        </div>

        <div className="relative z-10 max-w-lg">
          <span className="animate__animated animate__fadeInUp inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/20">
            <Sparkles className="h-3.5 w-3.5" />
            Đọc báo giá tự động bằng AI
          </span>
          <h1 className="animate__animated animate__fadeInUp mt-5 text-4xl font-semibold leading-[1.15] tracking-tight">
            Lập hóa đơn từ báo giá,
            <br />
            không còn nhập tay từng dòng.
          </h1>
          <p className="animate__animated animate__fadeInUp mt-4 max-w-md text-sm leading-relaxed text-primary-foreground/80">
            Tải báo giá lên, hệ thống đọc dữ liệu, ghép khách hàng và mã hàng trong danh mục, rồi
            xuất file Excel đúng mẫu để import lên phần mềm hóa đơn.
          </p>

          <ul className="mt-10 grid gap-4">
            {FEATURES.map((f, i) => (
              <li
                key={f.title}
                className="animate__animated animate__fadeInLeft flex items-start gap-3"
                style={{ animationDelay: `${360 + i * 140}ms` }}
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <f.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="mt-0.5 text-sm text-primary-foreground/70">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="animate__animated animate__fadeIn relative z-10 text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} IdleInvoice · Dữ liệu lưu cục bộ trên máy chủ của bạn.
        </p>
      </aside>

      {/* Cột phải: form đăng nhập */}
      <main className="relative flex items-center justify-center px-5 py-12 sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(60% 45% at 70% 0%, hsl(var(--primary) / 0.08), transparent 70%)',
          }}
        />
        <div className="w-full max-w-sm">
          <div className="animate__animated animate__fadeInDown mb-8 flex items-center gap-3 lg:hidden">
            <img src="/logo.png" alt="IdleInvoice" className="h-10 w-10 rounded-xl object-contain" />
            <span className="text-lg font-semibold">IdleInvoice</span>
          </div>

          <Card className="animate__animated animate__fadeInUp shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-2xl tracking-tight">Đăng nhập</CardTitle>
              <CardDescription>Dùng tài khoản do quản trị viên cấp.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
                <div
                  className="animate__animated animate__fadeInUp"
                  style={{ animationDelay: '120ms' }}
                >
                  <Field label="Email" htmlFor="email" error={errors.email?.message}>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="username"
                      autoFocus
                      placeholder="ten@congty.vn"
                      aria-invalid={Boolean(errors.email)}
                      {...register('email')}
                    />
                  </Field>
                </div>

                <div
                  className="animate__animated animate__fadeInUp"
                  style={{ animationDelay: '200ms' }}
                >
                  <Field label="Mật khẩu" htmlFor="password" error={errors.password?.message}>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        aria-invalid={Boolean(errors.password)}
                        className="pr-10"
                        {...register('password')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>
                </div>

                {serverError && (
                  <p
                    key={errorShake}
                    role="alert"
                    className="animate__animated animate__headShake rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {serverError}
                  </p>
                )}

                <Button
                  type="submit"
                  className={cn('group mt-1 w-full', !isSubmitting && 'animate__animated animate__fadeInUp')}
                  style={{ animationDelay: '280ms' }}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                  )}
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
              <p>
                Chưa có tài khoản?{' '}
                <Link to="/register" className="font-medium text-primary hover:underline">
                  Đăng ký
                </Link>
              </p>
            </CardFooter>
          </Card>

          <p
            className="animate__animated animate__fadeIn mt-6 text-center text-xs text-muted-foreground"
            style={{ animationDelay: '420ms' }}
          >
            Gặp khó khăn khi đăng nhập? Liên hệ quản trị viên hệ thống.
          </p>
        </div>
      </main>
    </div>
  );
}
