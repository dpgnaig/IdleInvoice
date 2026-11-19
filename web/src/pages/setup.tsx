import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Check, FileSpreadsheet, Loader2, Upload, UserPlus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
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
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <Check className="h-10 w-10" />
        </motion.div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Bạn đã thiết lập thành công!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Hệ thống đã sẵn sàng. Tự động chuyển về trang chủ sau {countdown} giây…
        </p>
        <Button className="mt-6" onClick={() => navigate('/', { replace: true })}>
          Vào trang chủ ngay
        </Button>
      </div>
    );
  }

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
          className="mt-6 rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
        >
          {step === 1 && (
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold">Tạo tài khoản quản trị</h2>
              <Field label="Họ và tên" htmlFor="s-name">
                <Input
                  id="s-name"
                  value={admin.fullName}
                  onChange={(e) => setAdmin({ ...admin, fullName: e.target.value })}
                />
              </Field>
              <Field label="Email" htmlFor="s-email">
                <Input
                  id="s-email"
                  type="email"
                  value={admin.email}
                  onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
                />
              </Field>
              <Field label="Mật khẩu" htmlFor="s-pass" hint="Tối thiểu 8 ký tự, có chữ và số.">
                <Input
                  id="s-pass"
                  type="password"
                  value={admin.password}
                  onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                />
              </Field>
              <div className="flex items-center justify-end gap-2">
                <Button
                  onClick={() => void createAdmin()}
                  disabled={busy || !admin.email || admin.password.length < 8 || admin.fullName.length < 2}
                >
                  {busy && <Loader2 className="animate-spin" />}
                  {status?.hasAdmin ? 'Tiếp tục' : 'Tạo tài khoản và tiếp tục'}
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold">Import danh mục</h2>
              <p className="text-sm text-muted-foreground">
                Tải file Excel mẫu (như <code>HĐ-_mẫu.xlsx</code>) có sheet DSKH và sheet DSHH/DSSP.
                Nếu bỏ qua bước này, danh mục sẽ trống và chỉ thêm được từng bản ghi sau đó.
              </p>
              <label
                className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors hover:bg-muted/50"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) void doPreview(f);
                }}
              >
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">Kéo thả hoặc bấm để chọn file .xlsx</span>
                <span className="text-xs text-muted-foreground">Tối đa 10 MB</span>
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
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4">
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
                  <ImportPreviewTable title="Khách hàng (DSKH)" kind="customer" group={preview.customers} />
                  <ImportPreviewTable title="Hàng hóa (DSSP)" kind="product" group={preview.products} />
                  <div className="flex items-center justify-end gap-2">
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
            <div className="grid gap-4">
              <h2 className="text-lg font-semibold">Hoàn tất thiết lập</h2>
              <div className="grid gap-3 rounded-lg border p-4">
                <div className="grid gap-1">
                  <p className="text-sm font-medium">Lịch sử hóa đơn đã xuất (tùy chọn)</p>
                  <p className="text-xs text-muted-foreground">
                    Tải file ExportFast.xlsx để hệ thống gợi ý giá gần nhất và cảnh báo xuất trùng.
                  </p>
                </div>
                {historyAdded !== null ? (
                  <p className="text-sm text-primary">Đã nhập {historyAdded} dòng lịch sử.</p>
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
              <ul className="grid gap-1 text-sm text-muted-foreground">
                <li>Tài khoản quản trị: {admin.email || 'đã tạo trước đó'}</li>
                <li>Khách hàng: {commitResult?.customersAdded ?? status?.counts.customers ?? 0}</li>
                <li>Hàng hóa: {commitResult?.productsAdded ?? status?.counts.products ?? 0}</li>
              </ul>
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                Sau khi bấm hoàn tất, toàn bộ chức năng thiết lập và import hàng loạt sẽ bị khóa.
              </p>
              <div className="flex items-center justify-end gap-2">
                {!commitResult && (
                  <Button variant="outline" onClick={() => setStep(2)}>
                    Quay lại
                  </Button>
                )}
                <Button onClick={() => void complete()} disabled={busy}>
                  {busy && <Loader2 className="animate-spin" />}
                  Hoàn tất và vào hệ thống
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
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
    <div className="rounded-lg border p-4">
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
