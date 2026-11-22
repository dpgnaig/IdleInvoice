import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

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
      const { data } = await api.post(endpoints.auth.register, {
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
          <img src="/logo.png" alt="QuoteFlow" className="h-10 w-10 rounded-xl object-contain" />
          <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 bg-clip-text text-lg font-black text-transparent">QuoteFlow</span>
        </div>

        {done ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card>
              <CardHeader>
                <CheckCircle2 className="h-9 w-9 text-primary" />
                <CardTitle>
                  {done.status === 'pending' ? 'Đang chờ quản trị viên duyệt' : 'Đăng ký thành công'}
                </CardTitle>
                <CardDescription>{done.message}</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button asChild className="w-full">
                  <Link to="/login">Về trang đăng nhập</Link>
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl tracking-tight">Đăng ký tài khoản</CardTitle>
              <CardDescription>
                Tài khoản mới có thể cần quản trị viên duyệt trước khi đăng nhập.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
                <Field label="Họ và tên" htmlFor="fullName" error={errors.fullName?.message}>
                  <Input id="fullName" autoComplete="name" {...register('fullName')} />
                </Field>
                <Field label="Email" htmlFor="email" error={errors.email?.message}>
                  <Input id="email" type="email" autoComplete="username" {...register('email')} />
                </Field>
                <Field
                  label="Mật khẩu"
                  htmlFor="password"
                  hint="Tối thiểu 8 ký tự, có chữ và số."
                  error={errors.password?.message}
                >
                  <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
                </Field>
                <Field label="Nhập lại mật khẩu" htmlFor="confirm" error={errors.confirm?.message}>
                  <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
                </Field>
                {serverError && (
                  <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {serverError}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="animate-spin" />}
                  Đăng ký
                </Button>
              </form>
            </CardContent>
            <CardFooter className="text-sm text-muted-foreground">
              <p>
                Đã có tài khoản?{' '}
                <Link to="/login" className="font-medium text-primary hover:underline">Đăng nhập</Link>
              </p>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
