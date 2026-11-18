import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Check, FileSpreadsheet, Loader2, Upload, UserPlus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

interface PreviewResult {
  uploadId: string;
  fileName: string;
  customers: {
    total: number;
    valid: number;
    duplicateInFile: number;
    duplicateInDb: number;
    sample: Array<Record<string, unknown>>;
    issues: Array<{ rowNumber: number; reason: string; taxCode?: string; name?: string }>;
    issueCount: number;
  };
  products: {
    total: number;
    valid: number;
    duplicateInFile: number;
    duplicateInDb: number;
    sample: Array<Record<string, unknown>>;
    issues: Array<{ rowNumber: number; reason: string; taxCode?: string; name?: string }>;
    issueCount: number;
  };
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
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const [admin, setAdmin] = useState({ fullName: '', email: '', password: '' });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<{ customersAdded: number; productsAdded: number } | null>(null);
  const [historyAdded, setHistoryAdded] = useState<number | null>(null);

  const importHistory = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const { data: pv } = await api.post<{ uploadId: string; total: number }>('/setup/import/history/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!pv.total) {
        toast.error('Không đọc được dòng lịch sử nào trong file');
        return;
      }
      const { data } = await api.post<{ added: number }>('/setup/import/history/commit', { uploadId: pv.uploadId });
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
      .get<Status>('/setup/status')
      .then((r) => {
        setStatus(r.data);
        if (r.data.setupCompleted) navigate('/', { replace: true });
        // tiếp tục từ bước đang dở
        setStep(Math.min(3, Math.max(1, r.data.step)));
      })
      .catch(() => toast.error('Không đọc được trạng thái thiết lập'));
  }, [navigate]);

  const createAdmin = async () => {
    setBusy(true);
    try {
      await api.post('/setup/admin', admin);
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
      const { data } = await api.post<PreviewResult>('/setup/import/preview', fd, {
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
      const { data } = await api.post('/setup/import/commit', { uploadId: preview.uploadId });
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
      await api.post('/setup/complete');
      // đăng nhập admin để vào thẳng dashboard
      try {
        await login(admin.email, admin.password);
      } catch {
        /* người dùng tự đăng nhập */
      }
      toast.success('Thiết lập hoàn tất!');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Thiết lập ban đầu</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chỉ chạy một lần. Sau khi hoàn tất, chức năng import hàng loạt sẽ bị khóa vĩnh viễn.
        </p>
      </div>

      <ol className="mt-8 flex items-center gap-3" aria-label="Các bước thiết lập">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const Icon = s.icon;
          const active = n === step;
          const done = n < step;
          return (
            <li key={s.title} className="flex flex-1 items-center gap-3">
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-medium',
                  done && 'border-primary bg-primary text-primary-foreground',
                  active && !done && 'border-primary text-primary',
                  !active && !done && 'text-muted-foreground',
                )}
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className={cn('truncate text-sm font-medium', !active && !done && 'text-muted-foreground')}>
                  {s.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">{s.description}</p>
              </div>
              {n < STEPS.length && <div className="h-px flex-1 bg-border" />}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full bg-primary"
          animate={{ width: `${(step / 3) * 100}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 28 }}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.2 }}
          className="card-surface mt-6 p-6"
        >
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Tạo tài khoản quản trị</h2>
              <div>
                <label htmlFor="s-name" className="label">Họ và tên</label>
                <input
                  id="s-name"
                  className="input"
                  value={admin.fullName}
                  onChange={(e) => setAdmin({ ...admin, fullName: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="s-email" className="label">Email</label>
                <input
                  id="s-email"
                  type="email"
                  className="input"
                  value={admin.email}
                  onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="s-pass" className="label">Mật khẩu</label>
                <input
                  id="s-pass"
                  type="password"
                  className="input"
                  value={admin.password}
                  onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                />
                <p className="mt-1 text-xs text-muted-foreground">Tối thiểu 8 ký tự, có chữ và số.</p>
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void createAdmin()}
                disabled={busy || !admin.email || admin.password.length < 8 || admin.fullName.length < 2}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {status?.hasAdmin ? 'Tiếp tục' : 'Tạo tài khoản và tiếp tục'}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Import danh mục</h2>
              <p className="text-sm text-muted-foreground">
                Tải file Excel mẫu (như <code>HĐ-_mẫu.xlsx</code>) có sheet DSKH và sheet DSHH/DSSP.
                Nếu bỏ qua bước này, danh mục sẽ trống và chỉ thêm được từng bản ghi sau đó.
              </p>
              <label
                className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors hover:bg-muted/50"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) void doPreview(f);
                }}
              >
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                <span className="mt-2 text-sm font-medium">Kéo thả hoặc bấm để chọn file .xlsx</span>
                <span className="mt-1 text-xs text-muted-foreground">Tối đa 10 MB</span>
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
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
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
                  <PreviewTable
                    rows={preview.customers.sample as Array<{ taxCode: string; name: string }>}
                    columns={[
                      { key: 'taxCode', label: 'Mã số thuế' },
                      { key: 'name', label: 'Đơn vị mua hàng' },
                    ]}
                  />
                  {[...preview.customers.issues, ...preview.products.issues].length > 0 && (
                    <details className="rounded-xl border p-3 text-sm">
                      <summary className="cursor-pointer font-medium">
                        Dòng lỗi / trùng ({preview.customers.issueCount + preview.products.issueCount})
                      </summary>
                      <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-muted-foreground">
                        {[...preview.customers.issues, ...preview.products.issues].slice(0, 100).map((i, idx) => (
                          <li key={idx}>
                            Dòng {i.rowNumber}: {i.reason} {i.taxCode ? `(${i.taxCode})` : ''}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-outline" onClick={() => setStep(3)} disabled={busy}>
                      Bỏ qua bước này
                    </button>
                    <button type="button" className="btn-primary" onClick={() => void doCommit()} disabled={busy}>
                      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                      Xác nhận import
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Hoàn tất thiết lập</h2>
              <div className="rounded-xl border p-4">
                <p className="text-sm font-medium">Lịch sử hóa đơn đã xuất (tùy chọn)</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tải file ExportFast.xlsx để hệ thống gợi ý giá gần nhất và cảnh báo xuất trùng.
                </p>
                {historyAdded !== null ? (
                  <p className="mt-3 text-sm text-primary">Đã nhập {historyAdded} dòng lịch sử.</p>
                ) : (
                  <label className="btn-outline mt-3 cursor-pointer">
                    <Upload className="h-4 w-4" /> Chọn file lịch sử
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
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>Tài khoản quản trị: {admin.email || 'đã tạo trước đó'}</li>
                <li>Khách hàng: {commitResult?.customersAdded ?? status?.counts.customers ?? 0}</li>
                <li>Hàng hóa: {commitResult?.productsAdded ?? status?.counts.products ?? 0}</li>
              </ul>
              <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                Sau khi bấm hoàn tất, toàn bộ chức năng thiết lập và import hàng loạt sẽ bị khóa.
              </p>
              <div className="flex justify-end gap-2">
                {!commitResult && (
                  <button type="button" className="btn-outline" onClick={() => setStep(2)}>
                    Quay lại
                  </button>
                )}
                <button type="button" className="btn-primary" onClick={() => void complete()} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Hoàn tất và vào hệ thống
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function SummaryCard({
  title, total, valid, dupFile, dupDb, issues,
}: {
  title: string; total: number; valid: number; dupFile: number; dupDb: number; issues: number;
}) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-2 text-2xl font-semibold">{total}</p>
      <p className="text-xs text-muted-foreground">dòng đọc được</p>
      <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between"><dt>Sẽ thêm</dt><dd>{valid}</dd></div>
        <div className="flex justify-between"><dt>Trùng trong file</dt><dd>{dupFile}</dd></div>
        <div className="flex justify-between"><dt>Đã có trong DB</dt><dd>{dupDb}</dd></div>
        <div className="flex justify-between"><dt>Dòng lỗi</dt><dd>{issues}</dd></div>
      </dl>
    </div>
  );
}

function PreviewTable<T extends Record<string, unknown>>({
  rows, columns,
}: {
  rows: T[];
  columns: Array<{ key: string; label: string }>;
}) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="th">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {columns.map((c) => (
                <td key={c.key} className="td">{String(r[c.key] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
