import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertTriangle, CheckCircle2, FileUp, Info, Loader2, Plus, SearchCheck, Trash2, X,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn, formatDate, formatMoney, todayIso } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { CountUpMoney } from '@/components/ui/count-up';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';

interface MatchCandidate { id: number; code: string; name: string; unit: string; score?: number; reason?: string }
interface ParsedLine {
  line_no: number; name: string; unit: string; qty: number | null; unit_price: number | null;
  amount: number | null; model: string; brand: string; origin: string; spec_text: string;
  confidence: 'high' | 'medium' | 'low';
}
interface DraftLine {
  parsed: ParsedLine;
  productMatch: { status: 'matched' | 'candidate' | 'unmatched'; productId: number | null; product?: MatchCandidate | null; candidates?: MatchCandidate[] };
  qty: number | null;
  unitPrice: number | null;
  amount: number | null;
  taxRate: number | string;
}
interface CustomerMatch {
  status: 'matched' | 'candidate' | 'new_customer';
  customerId: number | null;
  customer?: { id: number; taxCode: string; name: string } | null;
  candidates?: Array<{ id: number; taxCode: string; name: string; score: number }>;
}
interface Draft {
  fileHash: string;
  originalName: string;
  status: string;
  duplicateFile?: boolean;
  message?: string;
  errorCode?: string;
  customerMatch?: CustomerMatch;
  lines?: DraftLine[];
  warnings?: string[];
  parsed?: {
    buyerName: string; buyerTaxCode: string; quoteNo: string; quoteDate: string;
    declaredSubtotal: number | null; declaredVat: number | null; declaredTotal: number | null;
    taxRate: number | null; paymentTerms: string; validityDays: number | null;
  };
}

interface EditableLine {
  key: string;
  parsed: ParsedLine;
  productId: number | null;
  product: MatchCandidate | null;
  candidates: MatchCandidate[];
  qty: number | null;
  unitPrice: number | null;
  taxRate: number | string;
  remember: boolean;
}

interface EditableDraft {
  fileHash: string;
  fileName: string;
  failed?: { message: string };
  buyerName: string;
  buyerTaxCode: string;
  quoteNo: string;
  quoteDate: string;
  customerId: number | null;
  customerCandidates: Array<{ id: number; taxCode: string; name: string }>;
  rememberCustomer: boolean;
  warnings: string[];
  lines: EditableLine[];
  declared: { subtotal: number | null; vat: number | null; total: number | null };
}

const TAX_OPTIONS: ComboOption[] = [
  { value: '0', label: '0%' },
  { value: '0.05', label: '5%' },
  { value: '0.08', label: '8%' },
  { value: '0.1', label: '10%' },
  { value: 'KCT', label: 'KCT (không chịu thuế)' },
  { value: 'KKKNT', label: 'KKKNT (không kê khai nộp thuế)' },
];

export default function QuoteImportPage() {
  const qc = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Array<{ name: string; pct: number }>>([]);
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [newCustomerFor, setNewCustomerFor] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const customers = useQuery({
    queryKey: ['customers-all'],
    queryFn: async () => {
      const { data } = await api.get('/customers', { params: { pageSize: 200 } });
      return data.data as Array<{ id: number; name: string; taxCode: string }>;
    },
  });

  const productsQuery = useQuery({
    queryKey: ['products-all'],
    queryFn: async () => {
      const { data } = await api.get('/products', { params: { pageSize: 200 } });
      return data.data as MatchCandidate[];
    },
  });

  const customerOptions: ComboOption[] = (customers.data ?? []).map((c) => ({
    value: String(c.id), label: c.name, hint: `MST ${c.taxCode}`,
  }));
  const productOptions: ComboOption[] = (productsQuery.data ?? []).map((p) => ({
    value: String(p.id), label: p.name, hint: `${p.code} · ${p.unit}`,
  }));

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      setProgress(files.map((f) => ({ name: f.name, pct: 15 })));
      const { data } = await api.post('/quotes/parse', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 60) : 40;
          setProgress(files.map((f) => ({ name: f.name, pct })));
        },
      });
      return data.drafts as Draft[];
    },
    onSuccess: (incoming) => {
      setProgress(incoming.map((d) => ({ name: d.originalName, pct: 100 })));
      const mapped = incoming.map(toEditable);
      setDrafts((prev) => [...prev, ...mapped]);
      setTimeout(() => setProgress([]), 700);
      const ok = incoming.filter((d) => d.status !== 'failed').length;
      if (ok) toast.success(`Đọc xong ${ok} báo giá`);
    },
    onError: (e) => { setProgress([]); toast.error(apiErrorMessage(e)); },
  });

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files).filter((f) => /\.(pdf|xls|xlsx)$/i.test(f.name));
    if (!arr.length) { toast.error('Chỉ hỗ trợ file .pdf, .xlsx, .xls'); return; }
    void upload.mutateAsync(arr);
  }, [upload]);

  const updateDraft = (idx: number, patch: Partial<EditableDraft>) =>
    setDrafts((ds) => ds.map((d, i) => (i === idx ? { ...d, ...patch } : d)));

  const updateLine = (dIdx: number, lIdx: number, patch: Partial<EditableLine>) =>
    setDrafts((ds) =>
      ds.map((d, i) =>
        i === dIdx ? { ...d, lines: d.lines.map((l, j) => (j === lIdx ? { ...l, ...patch } : l)) } : d,
      ),
    );

  const removeDraft = (idx: number) => setDrafts((ds) => ds.filter((_, i) => i !== idx));

  const canConfirm = (d: EditableDraft) =>
    !d.failed && d.customerId !== null && d.quoteNo.trim().length > 0 &&
    d.lines.length > 0 && d.lines.every((l) => l.productId !== null && (l.qty ?? 0) > 0);

  const confirmOne = async (d: EditableDraft) => {
    await api.post('/quotes/confirm', {
      quoteNo: d.quoteNo,
      quoteDate: d.quoteDate || null,
      customerId: d.customerId,
      fileHash: d.fileHash,
      declaredSubtotal: d.declared.subtotal,
      declaredVat: d.declared.vat,
      declaredTotal: d.declared.total,
      validityDays: null,
      note: '',
      rememberCustomerAlias: d.rememberCustomer,
      aliasText: d.buyerName,
      lines: d.lines.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        unitPrice: l.unitPrice ?? 0,
        taxRate: l.taxRate === 'KCT' || l.taxRate === 'KKKNT' ? l.taxRate : Number(l.taxRate),
        rememberAlias: l.remember,
        aliasText: l.parsed.model,
      })),
    });
  };

  const confirmAll = useMutation({
    mutationFn: async () => {
      const ready = drafts.filter(canConfirm);
      for (const d of ready) await confirmOne(d);
      return ready.length;
    },
    onSuccess: (n) => {
      toast.success(`Đã lưu ${n} hóa đơn nháp`);
      setDrafts((ds) => ds.filter((d) => !canConfirm(d)));
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const readyCount = drafts.filter(canConfirm).length;

  return (
    <div>
      <PageHeader
        title="Nhập báo giá"
        description="Kéo thả báo giá PDF/Excel, đối chiếu khách hàng và mã hàng rồi xác nhận thành hóa đơn nháp."
        actions={
          drafts.length > 0 && (
            <button
              className="btn-primary"
              disabled={readyCount === 0 || confirmAll.isPending}
              onClick={() => void confirmAll.mutateAsync()}
            >
              {confirmAll.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận tất cả ({readyCount})
            </button>
          )
        }
      />

      <motion.label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        animate={dragging ? { scale: 1.005 } : { scale: 1 }}
        className={cn(
          'relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
        )}
      >
        {dragging && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-primary"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ repeat: Infinity, duration: 1.6 }}
          />
        )}
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <FileUp className="h-6 w-6" />
        </div>
        <p className="mt-4 text-sm font-medium">Kéo thả báo giá vào đây hoặc bấm để chọn</p>
        <p className="mt-1 text-xs text-muted-foreground">Hỗ trợ .pdf, .xlsx, .xls · tối đa 10 MB/file · có thể chọn nhiều file</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.xlsx,.xls"
          className="sr-only"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </motion.label>

      <AnimatePresence>
        {progress.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 space-y-2 overflow-hidden"
          >
            {progress.map((p) => (
              <div key={p.name} className="card-surface px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.pct}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full bg-primary"
                    animate={{ width: `${p.pct}%` }}
                    transition={{ type: 'spring', stiffness: 160, damping: 26 }}
                  />
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 space-y-6">
        <AnimatePresence>
          {drafts.map((d, idx) => (
            <motion.div
              key={d.fileHash + idx}
              layout
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ delay: Math.min(idx * 0.05, 0.3) }}
              className="card-surface overflow-hidden"
            >
              <DraftCard
                draft={d}
                customerOptions={customerOptions}
                productOptions={productOptions}
                onChange={(patch) => updateDraft(idx, patch)}
                onLineChange={(lIdx, patch) => updateLine(idx, lIdx, patch)}
                onRemove={() => removeDraft(idx)}
                canConfirm={canConfirm(d)}
                onConfirm={async () => {
                  try {
                    await confirmOne(d);
                    toast.success('Đã lưu hóa đơn nháp');
                    removeDraft(idx);
                    void qc.invalidateQueries({ queryKey: ['invoices'] });
                  } catch (e) {
                    toast.error(apiErrorMessage(e));
                  }
                }}
                onNewCustomer={() => setNewCustomerFor(idx)}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        {drafts.length === 0 && !upload.isPending && (
          <div className="card-surface">
            <EmptyState
              title="Chưa có báo giá nào"
              description="Tải lên báo giá PDF hoặc Excel để bắt đầu. Hệ thống sẽ đọc dữ liệu và gợi ý ghép khách hàng, mã hàng."
            />
          </div>
        )}
      </div>

      <NewCustomerDialog
        open={newCustomerFor !== null}
        onOpenChange={(v) => !v && setNewCustomerFor(null)}
        initialName={newCustomerFor !== null ? drafts[newCustomerFor]?.buyerName ?? '' : ''}
        initialTaxCode={newCustomerFor !== null ? drafts[newCustomerFor]?.buyerTaxCode ?? '' : ''}
        onCreated={(c) => {
          const idx = newCustomerFor;
          void qc.invalidateQueries({ queryKey: ['customers-all'] });
          void qc.invalidateQueries({ queryKey: ['customers'] });
          if (idx !== null) updateDraft(idx, { customerId: c.id, rememberCustomer: true });
          toast.success(`Đã thêm khách hàng ${c.name}`);
        }}
      />
    </div>
  );
}

function toEditable(d: Draft): EditableDraft {
  if (d.status === 'failed' || !d.parsed) {
    return {
      fileHash: d.fileHash, fileName: d.originalName, failed: { message: d.message ?? 'Không đọc được file' },
      buyerName: '', buyerTaxCode: '', quoteNo: '', quoteDate: '', customerId: null,
      customerCandidates: [], rememberCustomer: true, warnings: [], lines: [],
      declared: { subtotal: null, vat: null, total: null },
    };
  }
  const cm = d.customerMatch!;
  const lines = (d.lines ?? []).map((l, i) => ({
    key: `${i}-${l.parsed.line_no}`,
    parsed: l.parsed,
    productId: l.productMatch.productId ?? l.productMatch.candidates?.[0]?.id ?? null,
    product: l.productMatch.product ?? l.productMatch.candidates?.[0] ?? null,
    candidates: l.productMatch.candidates ?? [],
    qty: l.qty,
    unitPrice: l.unitPrice,
    taxRate: l.taxRate ?? 0.08,
    remember: true,
  }));
  return {
    fileHash: d.fileHash,
    fileName: d.originalName,
    buyerName: d.parsed.buyerName,
    buyerTaxCode: d.parsed.buyerTaxCode,
    quoteNo: d.parsed.quoteNo,
    quoteDate: d.parsed.quoteDate || todayIso(),
    customerId: cm.customerId ?? null,
    customerCandidates: cm.candidates ?? [],
    rememberCustomer: true,
    warnings: d.warnings ?? [],
    lines,
    declared: { subtotal: d.parsed.declaredSubtotal, vat: d.parsed.declaredVat, total: d.parsed.declaredTotal },
  };
}

function NewCustomerDialog({
  open, onOpenChange, initialName, initialTaxCode, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialName: string;
  initialTaxCode: string;
  onCreated: (c: { id: number; name: string; taxCode: string }) => void;
}) {
  const [taxCode, setTaxCode] = useState(initialTaxCode);
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Mở lại cho file khác -> nạp lại dữ liệu đọc được từ báo giá
  useEffect(() => {
    if (!open) return;
    setTaxCode(initialTaxCode);
    setName(initialName);
    setAddress('');
    setEmail('');
    setBuyerName('');
    setNote(null);
  }, [open, initialName, initialTaxCode]);

  const lookup = async () => {
    if (!taxCode.trim()) return;
    setLooking(true);
    setNote(null);
    try {
      const { data } = await api.post('/customers/lookup-tax', { taxCode: taxCode.trim() });
      if (data.inDb) {
        setNote('MST này đã có trong danh mục — chọn lại ở ô Khách hàng thay vì tạo mới.');
        return;
      }
      if (data.found && data.info) {
        setName(data.info.name ?? name);
        setAddress(data.info.address ?? '');
        setNote('Đã điền thông tin từ tra cứu MST.');
      } else {
        setNote(data.message ?? 'Không tra cứu được MST, vui lòng nhập tay.');
      }
    } catch (e) {
      setNote(apiErrorMessage(e));
    } finally {
      setLooking(false);
    }
  };

  const save = async () => {
    if (!taxCode.trim() || !name.trim()) {
      setNote('Cần nhập mã số thuế và tên đơn vị.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/customers', {
        taxCode: taxCode.trim(),
        name: name.trim(),
        address: address.trim(),
        email: email.trim(),
        buyerName: buyerName.trim(),
        source: 'MANUAL',
      });
      onCreated({ id: data.id, name: data.name, taxCode: data.taxCode });
      onOpenChange(false);
    } catch (e) {
      setNote(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Thêm khách hàng"
      description="Thông tin được điền sẵn từ báo giá, có thể sửa trước khi lưu."
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="nc-mst" className="label">Mã số thuế</label>
          <div className="flex gap-2">
            <input
              id="nc-mst"
              className="input font-mono"
              value={taxCode}
              onChange={(e) => setTaxCode(e.target.value)}
              placeholder="0101234567"
            />
            <button type="button" className="btn-outline shrink-0" onClick={() => void lookup()} disabled={looking}>
              {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
              Tra cứu
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="nc-name" className="label">Tên đơn vị</label>
          <input id="nc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="nc-addr" className="label">Địa chỉ</label>
          <input id="nc-addr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="nc-buyer" className="label">Người mua</label>
            <input id="nc-buyer" className="input" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="nc-email" className="label">Email</label>
            <input id="nc-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        {note && (
          <p className="flex items-start gap-1.5 rounded-lg bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {note}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-outline" onClick={() => onOpenChange(false)}>Hủy</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Lưu khách hàng
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function DraftCard({
  draft, customerOptions, productOptions, onChange, onLineChange, onRemove, canConfirm, onConfirm, onNewCustomer,
}: {
  draft: EditableDraft;
  customerOptions: ComboOption[];
  productOptions: ComboOption[];
  onChange: (patch: Partial<EditableDraft>) => void;
  onLineChange: (idx: number, patch: Partial<EditableLine>) => void;
  onRemove: () => void;
  canConfirm: boolean;
  onConfirm: () => Promise<void>;
  onNewCustomer: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isPdf = /\.pdf$/i.test(draft.fileName);

  const openOriginal = async () => {
    try {
      setPreviewOpen(true);
      if (previewUrl) return;
      const res = await api.get(`/quotes/file/${draft.fileHash}`, { responseType: 'blob' });
      setPreviewUrl(URL.createObjectURL(res.data as Blob));
    } catch (e) {
      setPreviewOpen(false);
      toast.error(apiErrorMessage(e));
    }
  };

  const subtotal = draft.lines.reduce((s, l) => s + (l.qty ?? 0) * (l.unitPrice ?? 0), 0);
  const vat = draft.lines.reduce(
    (s, l) => s + (l.qty ?? 0) * (l.unitPrice ?? 0) * (typeof l.taxRate === 'number' ? l.taxRate : 0),
    0,
  );

  const lowConfidence = (l: EditableLine) => l.parsed.confidence === 'low';
  const unmatchedCount = draft.lines.filter((l) => l.productId === null).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-medium">{draft.fileName}</span>
          {draft.failed && <span className="badge bg-destructive/10 text-destructive">Lỗi đọc file</span>}
        </div>
        <div className="flex items-center gap-2">
          {!draft.failed && (
            <button className="btn-outline h-8 px-2 text-xs" onClick={() => void openOriginal()}>
              <FileUp className="h-3.5 w-3.5" /> File gốc
            </button>
          )}
          <button className="btn-ghost h-8 px-2 text-xs" onClick={onRemove} aria-label="Bỏ thẻ này">
            <X className="h-4 w-4" /> Bỏ
          </button>
          <button
            className="btn-primary h-8 px-3 text-xs"
            disabled={!canConfirm || busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
            title={canConfirm ? undefined : 'Cần ghép đủ khách hàng, mã hàng và số lượng'}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Xác nhận
          </button>
        </div>
      </div>

      {draft.failed ? (
        <div className="flex items-start gap-3 p-5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <p>{draft.failed.message}</p>
        </div>
      ) : (
        <div className="grid gap-0 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="border-b p-5 lg:border-b-0 lg:border-r">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nội dung đọc được</p>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Người mua" value={draft.buyerName || '—'} />
              <Row label="MST" value={draft.buyerTaxCode || '—'} mono />
              <Row label="Số báo giá" value={draft.quoteNo || '—'} />
              <Row label="Ngày" value={draft.quoteDate ? formatDate(draft.quoteDate) : '—'} />
              <Row label="Tổng trước VAT" value={draft.declared.subtotal != null ? formatMoney(draft.declared.subtotal) : '—'} />
              <Row label="VAT" value={draft.declared.vat != null ? formatMoney(draft.declared.vat) : '—'} />
              <Row label="Tổng cộng" value={draft.declared.total != null ? formatMoney(draft.declared.total) : '—'} />
            </dl>
            {draft.warnings.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {draft.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Khách hàng</label>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <Combobox
                      id={`cust-${draft.fileHash}`}
                      options={customerOptions}
                      value={draft.customerId ? String(draft.customerId) : null}
                      onChange={(v) => onChange({ customerId: Number(v) })}
                      placeholder="Chọn khách hàng"
                      searchPlaceholder="Tìm theo tên hoặc MST…"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-outline shrink-0 px-2.5"
                    onClick={onNewCustomer}
                    title="Tạo khách hàng mới từ thông tin trong báo giá"
                    aria-label="Tạo khách hàng mới"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {draft.customerId === null && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="h-3 w-3" /> Bắt buộc chọn khách hàng
                    {draft.customerCandidates.length > 0 && ' (có gợi ý bên dưới)'}
                  </p>
                )}
                {draft.customerCandidates.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {draft.customerCandidates.map((c) => (
                      <button
                        key={c.id}
                        className="badge bg-accent text-accent-foreground hover:bg-accent/80"
                        onClick={() => onChange({ customerId: c.id })}
                      >
                        {c.name} · {c.taxCode}
                      </button>
                    ))}
                  </div>
                )}
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={draft.rememberCustomer}
                    onChange={(e) => onChange({ rememberCustomer: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-input accent-primary"
                  />
                  Ghi nhớ tên này cho lần sau
                </label>
              </div>
              <div>
                <label htmlFor={`qno-${draft.fileHash}`} className="label">Số báo giá</label>
                <input
                  id={`qno-${draft.fileHash}`}
                  className="input"
                  value={draft.quoteNo}
                  onChange={(e) => onChange({ quoteNo: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`qdate-${draft.fileHash}`} className="label">Ngày báo giá</label>
                <input
                  id={`qdate-${draft.fileHash}`}
                  type="date"
                  className="input"
                  value={draft.quoteDate}
                  onChange={(e) => onChange({ quoteDate: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="th">Mã hàng</th>
                    <th className="th w-20">SL</th>
                    <th className="th w-32">Đơn giá</th>
                    <th className="th w-24">Thuế</th>
                    <th className="th w-32 text-right">Thành tiền</th>
                    <th className="th w-10" />
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((l, i) => (
                    <tr
                      key={l.key}
                      className={cn(
                        'border-t align-top',
                        l.productId === null && 'bg-destructive/5',
                        lowConfidence(l) && 'bg-amber-500/5',
                      )}
                    >
                      <td className="px-2 py-2">
                        <Combobox
                          id={`prod-${draft.fileHash}-${i}`}
                          options={productOptions.filter((o) =>
                            l.product && !productOptions.some((p) => p.value === String(l.product!.id))
                              ? true
                              : true,
                          )}
                          value={l.productId ? String(l.productId) : null}
                          onChange={(v, opt) => {
                            const prod = (productOptions.length, l.candidates.find((c) => String(c.id) === v))
                              ?? { id: Number(v), code: '', name: opt.label, unit: '' };
                            onLineChange(i, { productId: Number(v), product: prod });
                          }}
                          placeholder={l.parsed.name.slice(0, 28)}
                          searchPlaceholder="Tìm mã hoặc tên hàng…"
                        />
                        <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground" title={l.parsed.name}>
                          {l.parsed.name}
                        </p>
                        {l.candidates.length > 0 && l.productId !== l.candidates[0]!.id && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {l.candidates.slice(0, 3).map((c) => (
                              <button
                                key={c.id}
                                className="badge bg-accent text-[10px] text-accent-foreground"
                                onClick={() => onLineChange(i, { productId: c.id, product: c })}
                              >
                                {c.code}
                              </button>
                            ))}
                          </div>
                        )}
                        {l.productId === null && (
                          <p className="mt-1 text-[11px] text-destructive">Chưa ghép được mã hàng</p>
                        )}
                        {l.parsed.model && l.productId !== null && (
                          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={l.remember}
                              onChange={(e) => onLineChange(i, { remember: e.target.checked })}
                              className="h-3 w-3 rounded border-input accent-primary"
                            />
                            Ghi nhớ “{l.parsed.model}” cho lần sau?
                          </label>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="any"
                          className="input h-9 w-16 px-2 text-right"
                          value={l.qty ?? ''}
                          onChange={(e) => onLineChange(i, { qty: e.target.value ? Number(e.target.value) : null })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          step="1"
                          className="input h-9 w-28 px-2 text-right"
                          value={l.unitPrice ?? ''}
                          onChange={(e) => onLineChange(i, { unitPrice: e.target.value ? Number(e.target.value) : null })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          aria-label="Thuế suất"
                          className="input h-9 w-20 px-2"
                          value={typeof l.taxRate === 'number' ? String(l.taxRate) : l.taxRate}
                          onChange={(e) =>
                            onLineChange(i, {
                              taxRate: e.target.value === 'KCT' || e.target.value === 'KKKNT' ? e.target.value : Number(e.target.value),
                            })
                          }
                        >
                          {TAX_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.value === 'KCT' || o.value === 'KKKNT' ? o.value : o.label}</option>
                          ))}
                        </select>

                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatMoney((l.qty ?? 0) * (l.unitPrice ?? 0))}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                          aria-label="Xóa dòng"
                          onClick={() => onChange({ lines: draft.lines.filter((_, j) => j !== i) })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              className="btn-ghost mt-2 h-8 px-2 text-xs"
              onClick={() =>
                onChange({
                  lines: [
                    ...draft.lines,
                    {
                      key: `n-${Date.now()}`, parsed: { line_no: draft.lines.length + 1, name: '', unit: '', qty: 1, unit_price: 0, amount: 0, model: '', brand: '', origin: '', spec_text: '', confidence: 'high' },
                      productId: null, product: null, candidates: [], qty: 1, unitPrice: 0, taxRate: 0.08, remember: true,
                    },
                  ],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Thêm dòng
            </button>

            <div className="mt-4 space-y-1.5 rounded-xl bg-muted/60 px-4 py-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Tổng chưa VAT</span><CountUpMoney value={subtotal} /></div>
              <div className="flex justify-between"><span className="text-muted-foreground">VAT</span><CountUpMoney value={vat} /></div>
              <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
                <span>Tổng thanh toán</span><CountUpMoney value={subtotal + vat} className="text-primary" />
              </div>
            </div>

            {unmatchedCount > 0 && (
              <p className="mt-2 text-xs text-destructive">
                Còn {unmatchedCount} dòng chưa ghép được mã hàng — cần xử lý trước khi xác nhận.
              </p>
            )}
          </div>
        </div>
      )}

      {previewOpen && (
        <div className="border-t bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="truncate text-xs font-medium">{draft.fileName}</span>
            <div className="flex gap-1">
              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost h-7 px-2 text-xs"
                >
                  Mở tab mới
                </a>
              )}
              <button className="btn-ghost h-7 px-2 text-xs" onClick={() => setPreviewOpen(false)}>
                Đóng
              </button>
            </div>
          </div>
          {!previewUrl && <p className="text-xs text-muted-foreground">Đang tải file…</p>}
          {previewUrl && isPdf && (
            <iframe
              src={previewUrl}
              title={`Xem trước ${draft.fileName}`}
              className="h-[420px] w-full rounded-lg border bg-white"
            />
          )}
          {previewUrl && !isPdf && (
            <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
              File Excel không hiển thị trực tiếp trong trình duyệt.{' '}
              <a href={previewUrl} download={draft.fileName} className="font-medium text-primary hover:underline">
                Tải file để xem
              </a>
              .
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn('text-right', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  );
}
