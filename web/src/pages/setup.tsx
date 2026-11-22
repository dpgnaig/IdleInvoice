import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from '@/components/ui/sonner';
import {
  ArrowRight,
  Check,
  Database,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Loader2,
  PartyPopper,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPlus,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SegmentedControl, SearchInput } from '@/components/ui/toolbar';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMarkSetupDone } from '@/lib/setup-gate';

type ImportRowStatus = 'ok' | 'duplicate_in_file' | 'invalid';

interface ImportRow {
  rowNumber: number;
  taxCode?: string;
  code?: string;
  name: string;
  unit?: string;
  buyerName?: string;
  address?: string;
  email?: string;
  status: ImportRowStatus;
  duplicateOf: number | null;
  duplicateInDb: boolean;
  reason: string | null;
}

interface PreviewGroup {
  total: number;
  valid: number;
  duplicateInFile: number;
  duplicateInDb: number;
  invalid: number;
  /** Toàn bộ dòng đọc được từ sheet, kể cả dòng lỗi và dòng trùng. */
  rows: ImportRow[];
  issues: Array<{ rowNumber: number; reason: string; taxCode?: string; name?: string }>;
  issueCount: number;
}

interface PreviewResult {
  uploadId: string;
  fileName: string;
  customers: PreviewGroup;
  products: PreviewGroup;
}

interface Status {
  setupCompleted: boolean;
  hasAdmin: boolean;
  step: number;
  counts: { customers: number; products: number; history: number };
}

const STEPS = [
  { title: 'Tài khoản quản trị', description: 'Tạo tài khoản admin đầu tiên', icon: UserPlus },
  { title: 'Import danh mục', description: 'DSKH và DSSP từ file Excel mẫu', icon: Upload },
  { title: 'Hoàn tất', description: 'Khóa thiết lập và bắt đầu dùng', icon: Check },
];

export default function SetupPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const markSetupDone = useMarkSetupDone();
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [showPassword, setShowPassword] = useState(false);

  const [admin, setAdmin] = useState({ fullName: '', email: '', password: '' });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<{ customersAdded: number; productsAdded: number } | null>(null);
  const [historyAdded, setHistoryAdded] = useState<number | null>(null);
  const [importTab, setImportTab] = useState<'customers' | 'products'>('customers');

  const importHistory = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const { data: pv } = await api.post<{ uploadId: string; total: number }>(endpoints.setup.historyPreview, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!pv.total) {
        toast.error('Không đọc được dòng lịch sử nào trong file');
        return;
      }
      const { data } = await api.post<{ added: number }>(endpoints.setup.historyCommit, { uploadId: pv.uploadId });
      setHistoryAdded(data.added);
      toast.success(`Đã nhập ${data.added} dòng lịch sử hóa đơn`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    api
      .get<Status>(endpoints.setup.status)
      .then((r) => {
        setStatus(r.data);
        if (r.data.setupCompleted) navigate('/', { replace: true });
        // tiếp tục từ bước đang dở
        setStep(Math.min(3, Math.max(1, r.data.step)));
      })
      .catch(() => toast.error('Không đọc được trạng thái thiết lập'));
  }, [navigate]);

  // Màn hình thành công: đếm ngược rồi tự chuyển về trang chủ
  useEffect(() => {
    if (!finished) return;
    if (countdown <= 0) {
      navigate('/', { replace: true });
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [finished, countdown, navigate]);

  const createAdmin = async () => {
    setBusy(true);
    try {
      await api.post(endpoints.setup.admin, admin);
      toast.success('Đã tạo tài khoản quản trị');
      setStep(2);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const { data } = await api.post<PreviewResult>(endpoints.setup.importPreview, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const doCommit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const { data } = await api.post(endpoints.setup.importCommit, { uploadId: preview.uploadId });
      setCommitResult(data);
      toast.success('Đã import danh mục');
      setStep(3);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    setBusy(true);
    try {
      await api.post(endpoints.setup.complete);
      markSetupDone();
      // đăng nhập admin để vào thẳng dashboard
      try {
        await login(admin.email, admin.password);
      } catch {
        /* người dùng tự đăng nhập */
      }
      toast.success('Thiết lập hoàn tất!');
      setFinished(true);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (finished) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-5 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(50% 50% at 50% 40%, hsl(var(--primary) / 0.12), transparent 75%)',
          }}
        />
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 18 }}
          className="relative z-10 flex h-24 w-24 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-xl shadow-primary/30"
        >
          <PartyPopper className="h-11 w-11" />
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="relative z-10 mt-7 text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          Bạn đã thiết lập thành công!
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="relative z-10 mt-2 max-w-sm text-sm text-muted-foreground"
        >
          Hệ thống đã sẵn sàng. Tự động chuyển về trang chủ sau {countdown} giây…
        </motion.p>
        <Button
          className="relative z-10 mt-7"
          onClick={() => navigate('/', { replace: true })}
        >
          Vào trang chủ ngay
          <ArrowRight />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative grid min-h-screen bg-background lg:grid-cols-[400px_1fr]">
      {/* Cột trái: thương hiệu + tiến trình các bước */}
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
          className="pointer-events-none absolute -right-28 -top-28 h-[420px] w-[420px] rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 left-1/4 h-[340px] w-[340px] rounded-full bg-white/10 blur-2xl"
        />

        <div className="relative z-10 flex items-center gap-3">
          <img
            src="/logo.png"
            alt="QuoteFlow"
            className="h-11 w-11 rounded-xl bg-white object-contain p-1 shadow-xl shadow-fuchsia-900/40 ring-2 ring-amber-300/80"
          />
          <span className="bg-gradient-to-r from-white via-amber-200 to-sky-200 bg-clip-text text-xl font-brand font-black tracking-tight text-transparent">
            QuoteFlow
          </span>
        </div>

        <div className="relative z-10">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/20">
            <Sparkles className="h-3.5 w-3.5" />
            Thiết lập một lần
          </span>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-tight">
            Bắt đầu với
            <br />
            QuoteFlow
          </h1>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-primary-foreground/80">
            Ba bước nhanh để tạo tài khoản quản trị và nạp sẵn danh mục khách hàng, hàng hóa.
          </p>

          <ol className="mt-9 grid gap-1">
            {STEPS.map((s, i) => {
              const n = i + 1;
              const active = n === step;
              const done = n < step;
              const Icon = s.icon;
              return (
                <li key={s.title} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors',
                        done && 'border-white bg-white text-primary',
                        active && !done && 'border-white/80 bg-white/15 text-white ring-4 ring-white/10',
                        !active && !done && 'border-white/25 text-primary-foreground/60',
                      )}
                    >
                      {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </span>
                    {n < STEPS.length && (
                      <span
                        className={cn(
                          'my-1 w-px flex-1',
                          done ? 'bg-white/60' : 'bg-white/20',
                        )}
                      />
                    )}
                  </div>
                  <div className={cn('pb-7 transition-opacity', !active && !done && 'opacity-60')}>
                    <p className="text-sm font-medium">
                      <span className="mr-1.5 text-primary-foreground/50">{String(n).padStart(2, '0')}</span>
                      {s.title}
                    </p>
                    <p className="mt-0.5 text-xs text-primary-foreground/70">{s.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="relative z-10 flex items-center gap-1.5 text-xs text-primary-foreground/60">
          <ShieldCheck className="h-3.5 w-3.5" />
          Dữ liệu lưu cục bộ trên máy chủ của bạn.
        </p>
      </aside>

      {/* Cột phải: nội dung bước hiện tại */}
      <main className="relative flex flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(55% 40% at 80% 0%, hsl(var(--primary) / 0.08), transparent 70%)',
          }}
        />
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-10 sm:px-8">
          {/* Thương hiệu + stepper gọn cho màn nhỏ */}
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <img src="/logo.png" alt="QuoteFlow" className="h-10 w-10 rounded-xl object-contain" />
            <div>
              <p className="font-brand text-base font-semibold leading-tight">QuoteFlow</p>
              <p className="text-xs text-muted-foreground">Thiết lập ban đầu</p>
            </div>
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Bước {step} / {STEPS.length}
              </p>
              <div className="flex gap-1.5 lg:hidden">
                {STEPS.map((s, i) => (
                  <span
                    key={s.title}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i + 1 <= step ? 'w-6 bg-primary' : 'w-1.5 bg-border',
                    )}
                  />
                ))}
              </div>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                animate={{ width: `${(step / STEPS.length) * 100}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 28 }}
              />
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="rounded-2xl border bg-card p-6 text-card-foreground shadow-xl shadow-primary/5 sm:p-8"
            >
              {step === 1 && (
                <div className="grid gap-5">
                  <StepHeading
                    icon={UserPlus}
                    title="Tạo tài khoản quản trị"
                    description="Tài khoản này có toàn quyền cấu hình hệ thống."
                  />

                  <div className="grid gap-4">
                    <Field label="Họ và tên" htmlFor="s-name">
                      <Input
                        id="s-name"
                        value={admin.fullName}
                        onChange={(e) => setAdmin({ ...admin, fullName: e.target.value })}
                        placeholder="Nguyễn Văn A"
                        autoComplete="name"
                      />
                    </Field>
                    <Field label="Email" htmlFor="s-email">
                      <Input
                        id="s-email"
                        type="email"
                        value={admin.email}
                        onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
                        placeholder="ten@congty.vn"
                        autoComplete="username"
                      />
                    </Field>
                    <Field label="Mật khẩu" htmlFor="s-pass" hint="Tối thiểu 8 ký tự, có chữ và số.">
                      <div className="relative">
                        <Input
                          id="s-pass"
                          type={showPassword ? 'text' : 'password'}
                          value={admin.password}
                          onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                          autoComplete="new-password"
                          className="pr-10"
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

                  <div className="flex items-center justify-end border-t pt-4">
                    <Button
                      className="group"
                      onClick={() => void createAdmin()}
                      disabled={busy || !admin.email || admin.password.length < 8 || admin.fullName.length < 2}
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <ArrowRight className="transition-transform group-hover:translate-x-0.5" />}
                      {status?.hasAdmin ? 'Tiếp tục' : 'Tạo tài khoản và tiếp tục'}
                    </Button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="grid gap-5">
                  <StepHeading
                    icon={Database}
                    title="Import danh mục"
                    description="Nạp sẵn khách hàng và hàng hóa từ file Excel mẫu."
                  />
                  <p className="-mt-2 text-sm text-muted-foreground">
                    Tải file Excel mẫu (như <code className="rounded bg-muted px-1 py-0.5 text-xs">HĐ-_mẫu.xlsx</code>) có
                    sheet DSKH và sheet DSHH/DSSP. Bỏ qua bước này thì danh mục sẽ trống.
                  </p>

                  <label
                    className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 px-6 py-12 text-center transition-colors hover:border-primary/40 hover:bg-primary/5"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f) void doPreview(f);
                    }}
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                      <FileSpreadsheet className="h-7 w-7" />
                    </span>
                    <span className="text-sm font-medium">Kéo thả hoặc bấm để chọn file .xlsx</span>
                    <span className="text-xs text-muted-foreground">Tối đa 10 MB · DSKH và DSSP</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void doPreview(f);
                      }}
                    />
                  </label>

                  {busy && preview === null && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Đang đọc file…
                    </p>
                  )}

                  {preview && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <SummaryCard
                          title="Khách hàng (DSKH)"
                          total={preview.customers.total}
                          valid={preview.customers.valid}
                          dupFile={preview.customers.duplicateInFile}
                          dupDb={preview.customers.duplicateInDb}
                          issues={preview.customers.issueCount}
                        />
                        <SummaryCard
                          title="Hàng hóa (DSSP)"
                          total={preview.products.total}
                          valid={preview.products.valid}
                          dupFile={preview.products.duplicateInFile}
                          dupDb={preview.products.duplicateInDb}
                          issues={preview.products.issueCount}
                        />
                      </div>
                      <div className="min-w-0 rounded-xl border bg-card">
                        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
                          <SegmentedControl
                            ariaLabel="Chọn danh mục xem trước"
                            options={[
                              { value: 'customers', label: `Khách hàng (${preview.customers.total})` },
                              { value: 'products', label: `Hàng hóa (${preview.products.total})` },
                            ]}
                            value={importTab}
                            onChange={(v) => setImportTab(v as 'customers' | 'products')}
                          />
                        </div>
                        <div className="min-w-0 p-3">
                          {importTab === 'customers' ? (
                            <ImportPreviewTable
                              key="customers"
                              title="Khách hàng (DSKH)"
                              kind="customer"
                              group={preview.customers}
                            />
                          ) : (
                            <ImportPreviewTable
                              key="products"
                              title="Hàng hóa (DSSP)"
                              kind="product"
                              group={preview.products}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 border-t pt-4">
                        <Button variant="outline" onClick={() => setStep(3)} disabled={busy}>
                          Bỏ qua bước này
                        </Button>
                        <Button onClick={() => void doCommit()} disabled={busy}>
                          {busy && <Loader2 className="animate-spin" />}
                          Xác nhận import
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="grid gap-5">
                  <StepHeading
                    icon={Check}
                    title="Hoàn tất thiết lập"
                    description="Kiểm tra lại và khóa thiết lập để bắt đầu sử dụng."
                  />

                  <div className="grid gap-3 rounded-xl border bg-muted/20 p-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <FileSpreadsheet className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Lịch sử hóa đơn đã xuất (tùy chọn)</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Tải file ExportFast.xlsx để hệ thống gợi ý giá gần nhất và cảnh báo xuất trùng.
                        </p>
                      </div>
                    </div>
                    {historyAdded !== null ? (
                      <p className="flex items-center gap-1.5 text-sm text-primary">
                        <Check className="h-4 w-4" /> Đã nhập {historyAdded} dòng lịch sử.
                      </p>
                    ) : (
                      <label className={cn(buttonVariants({ variant: 'outline' }), 'w-fit cursor-pointer')}>
                        <Upload /> Chọn file lịch sử
                        <input
                          type="file"
                          accept=".xlsx"
                          className="sr-only"
                          disabled={busy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void importHistory(f);
                          }}
                        />
                      </label>
                    )}
                  </div>

                  <dl className="grid gap-2 rounded-xl border p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Tài khoản quản trị</dt>
                      <dd className="truncate font-medium">{admin.email || 'đã tạo trước đó'}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Khách hàng</dt>
                      <dd className="font-medium">{commitResult?.customersAdded ?? status?.counts.customers ?? 0}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Hàng hóa</dt>
                      <dd className="font-medium">{commitResult?.productsAdded ?? status?.counts.products ?? 0}</dd>
                    </div>
                  </dl>

                  <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                    Sau khi bấm hoàn tất, toàn bộ chức năng thiết lập và import hàng loạt sẽ bị khóa.
                  </p>

                  <div className="flex items-center justify-end gap-2 border-t pt-4">
                    {!commitResult && (
                      <Button variant="outline" onClick={() => setStep(2)}>
                        Quay lại
                      </Button>
                    )}
                    <Button className="group" onClick={() => void complete()} disabled={busy}>
                      {busy ? <Loader2 className="animate-spin" /> : <ArrowRight className="transition-transform group-hover:translate-x-0.5" />}
                      Hoàn tất và vào hệ thống
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function StepHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof UserPlus;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

type RowFilter = 'all' | 'addable' | 'dupFile' | 'dupDb' | 'invalid';

const FILTER_LABELS: Array<{ key: RowFilter; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'addable', label: 'Sẽ thêm' },
  { key: 'dupFile', label: 'Trùng trong file' },
  { key: 'dupDb', label: 'Đã có trong DB' },
  { key: 'invalid', label: 'Dòng lỗi' },
];

/** Dòng sẽ được ghi vào DB: hợp lệ và chưa có trong DB. */
const isAddable = (r: ImportRow) => r.status === 'ok' && !r.duplicateInDb;

const ROW_MATCH: Record<RowFilter, (r: ImportRow) => boolean> = {
  all: () => true,
  addable: isAddable,
  dupFile: (r) => r.status === 'duplicate_in_file',
  dupDb: (r) => r.status === 'ok' && r.duplicateInDb,
  invalid: (r) => r.status === 'invalid',
};

const ROW_TONE: Record<ImportRowStatus, string> = {
  ok: '',
  duplicate_in_file: 'bg-amber-500/10 hover:bg-amber-500/15',
  invalid: 'bg-destructive/10 hover:bg-destructive/15',
};

function SummaryCard({
  title, total, valid, dupFile, dupDb, issues,
}: {
  title: string; total: number; valid: number; dupFile: number; dupDb: number; issues: number;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{total}</p>
      <p className="text-xs text-muted-foreground">dòng đọc được</p>
      <dl className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
        <div className="flex justify-between"><dt className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Sẽ thêm</dt><dd className="font-medium text-foreground">{valid}</dd></div>
        <div className="flex justify-between"><dt>Trùng trong file</dt><dd>{dupFile}</dd></div>
        <div className="flex justify-between"><dt>Đã có trong DB</dt><dd>{dupDb}</dd></div>
        <div className="flex justify-between"><dt>Dòng lỗi</dt><dd>{issues}</dd></div>
      </dl>
    </div>
  );
}

function StatusBadge({ row }: { row: ImportRow }) {
  if (row.status === 'invalid') {
    return <Badge variant="destructive">Lỗi</Badge>;
  }
  if (row.status === 'duplicate_in_file') {
    return <Badge variant="warning">Trùng file</Badge>;
  }
  if (row.duplicateInDb) {
    return <Badge variant="info">Đã có</Badge>;
  }
  return <Badge variant="success">Sẽ thêm</Badge>;
}

/** Bảng xem trước import: hiển thị đủ mọi dòng, lọc theo trạng thái, tô sáng dòng trùng/lỗi. */
function ImportPreviewTable({
  title, kind, group,
}: {
  title: string;
  kind: 'customer' | 'product';
  group: PreviewGroup;
}) {
  const [filter, setFilter] = useState<RowFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const counts: Record<RowFilter, number> = useMemo(
    () => ({
      all: group.rows.length,
      addable: group.rows.filter(isAddable).length,
      dupFile: group.rows.filter((r) => r.status === 'duplicate_in_file').length,
      dupDb: group.rows.filter((r) => r.status === 'ok' && r.duplicateInDb).length,
      invalid: group.rows.filter((r) => r.status === 'invalid').length,
    }),
    [group.rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byFilter = group.rows.filter(ROW_MATCH[filter]);
    if (!q) return byFilter;
    return byFilter.filter((r) => {
      const haystack = kind === 'customer'
        ? `${r.taxCode ?? ''} ${r.name} ${r.buyerName ?? ''}`
        : `${r.code ?? ''} ${r.name} ${r.unit ?? ''}`;
      return haystack.toLowerCase().includes(q);
    });
  }, [group.rows, filter, query, kind]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">
          {group.total} dòng đọc được · đang hiển thị {filtered.length}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel={`Lọc ${title}`}
          options={FILTER_LABELS.map((f) => ({ value: f.key, label: `${f.label} (${counts[f.key]})` }))}
          value={filter}
          onChange={(v) => { setFilter(v as RowFilter); setPage(1); }}
        />
        <SearchInput
          className="ml-auto w-48"
          value={query}
          onChange={(v) => { setQuery(v); setPage(1); }}
          placeholder={kind === 'customer' ? 'Tìm MST, tên…' : 'Tìm mã, tên…'}
          ariaLabel={`Tìm trong ${title}`}
        />
      </div>

      <Table containerClassName="max-h-80 rounded-lg border">
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-16 px-4">Dòng</TableHead>
            <TableHead className="px-4">{kind === 'customer' ? 'Mã số thuế' : 'Mã hàng'}</TableHead>
            <TableHead className="px-4">{kind === 'customer' ? 'Đơn vị mua hàng' : 'Tên hàng hóa'}</TableHead>
            {kind === 'product' && <TableHead className="w-20 px-4">ĐVT</TableHead>}
            <TableHead className="w-28 px-4">Trạng thái</TableHead>
            <TableHead className="px-4">Ghi chú</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell className="px-4 py-3 text-muted-foreground" colSpan={kind === 'product' ? 6 : 5}>
                Không có dòng nào khớp bộ lọc.
              </TableCell>
            </TableRow>
          )}
          {visible.map((r) => (
            <TableRow key={r.rowNumber} className={ROW_TONE[r.status]}>
              <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.rowNumber}</TableCell>
              <TableCell className="px-4 py-3 font-mono text-xs">{r.taxCode || r.code || '—'}</TableCell>
              <TableCell className="px-4 py-3">{r.name || '—'}</TableCell>
              {kind === 'product' && <TableCell className="px-4 py-3">{r.unit || '—'}</TableCell>}
              <TableCell className="px-4 py-3"><StatusBadge row={r} /></TableCell>
              <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                {r.status === 'duplicate_in_file'
                  ? `Trùng với dòng ${r.duplicateOf}`
                  : r.status === 'invalid'
                    ? r.reason
                    : r.duplicateInDb
                      ? 'Đã có trong danh mục, sẽ bỏ qua'
                      : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <Pagination
          page={current}
          totalPages={totalPages}
          total={filtered.length}
          pageSize={PAGE_SIZE}
          unit="dòng"
          onChange={setPage}
        />
      )}
    </section>
  );
}
