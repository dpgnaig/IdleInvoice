import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertTriangle, CheckCircle2, FileUp, Info, Loader2, Plus, SearchCheck, Trash2, X,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn, formatMoney, todayIso } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useDebounced } from '@/lib/use-debounced';
import { CountUpMoney } from '@/components/ui/count-up';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

interface CustomerLite { id: number; taxCode: string; name: string }

/** MST chỉ giữ chữ số và dấu gạch ngang — giống normalizeTaxCode ở API. */
const normalizeTax = (s: string) => s.replace(/[\s.]/g, '').trim();

interface EditableDraft {
  fileHash: string;
  fileName: string;
  failed?: { message: string };
  buyerName: string;
  buyerTaxCode: string;
  quoteNo: string;
  quoteDate: string;
  customerId: number | null;
  /** Khách hàng đang chọn (đủ dữ liệu để hiện nhãn dù nằm ngoài trang tìm kiếm). */
  customer: CustomerLite | null;
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
            <Button
              disabled={readyCount === 0 || confirmAll.isPending}
              onClick={() => void confirmAll.mutateAsync()}
            >
              {confirmAll.isPending && <Loader2 className="animate-spin" />}
              Xác nhận tất cả ({readyCount})
            </Button>
          )
        }
      />

      <motion.label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        animate={dragging ? { scale: 1.005 } : { scale: 1 }}
        className={cn(
          'relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
        )}
      >
        {dragging && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-xl border-2 border-primary"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ repeat: Infinity, duration: 1.6 }}
          />
        )}
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
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
              <Card key={p.name} className="px-4 py-3">
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
              </Card>
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
              className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"
            >
              <DraftCard
                draft={d}
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
          <Card>
            <EmptyState
              title="Chưa có báo giá nào"
              description="Tải lên báo giá PDF hoặc Excel để bắt đầu. Hệ thống sẽ đọc dữ liệu và gợi ý ghép khách hàng, mã hàng."
            />
          </Card>
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
          if (idx !== null) updateDraft(idx, { customerId: c.id, customer: c, buyerTaxCode: c.taxCode, rememberCustomer: true });
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
      customer: null, customerCandidates: [], rememberCustomer: true, warnings: [], lines: [],
      declared: { subtotal: null, vat: null, total: null },
    };
  }
  const cm = d.customerMatch!;
  const lines = (d.lines ?? []).map((l, i) => {
    // Chỉ tự điền khi ghép CHẮC CHẮN (model trùng khít / alias).
    // Với `candidate` (nhiều mã cùng khớp, vd "LT - 040" -> LT-040-0.75/1.1/1.5/2.2kw)
    // thì để trống cho người dùng chọn — giá mỗi mã khác nhau, đoán bừa là sai tiền.
    const certain = l.productMatch.status === 'matched' ? l.productMatch.product ?? null : null;
    return {
      key: `${i}-${l.parsed.line_no}`,
      parsed: l.parsed,
      productId: certain?.id ?? null,
      product: certain,
      candidates: l.productMatch.candidates ?? [],
      qty: l.qty,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate ?? 0.08,
      remember: true,
    };
  });
  return {
    fileHash: d.fileHash,
    fileName: d.originalName,
    buyerName: d.parsed.buyerName,
    // File không có MST nhưng đã ghép được khách hàng (vd theo tên) -> điền MST của khách đó
    buyerTaxCode: d.parsed.buyerTaxCode || cm.customer?.taxCode || '',
    quoteNo: d.parsed.quoteNo,
    quoteDate: d.parsed.quoteDate || todayIso(),
    customerId: cm.customerId ?? null,
    customer: cm.customer ? { id: cm.customer.id, taxCode: cm.customer.taxCode, name: cm.customer.name } : null,
    customerCandidates: cm.candidates ?? [],
    rememberCustomer: true,
    warnings: d.warnings ?? [],
    lines,
    declared: { subtotal: d.parsed.declaredSubtotal, vat: d.parsed.declaredVat, total: d.parsed.declaredTotal },
  };
}

/**
 * Ô khách hàng của thẻ báo giá.
 * MST đọc được từ file nằm trong ô nhập; gõ/đổi MST sẽ tự tìm đúng khách hàng
 * (khớp chính xác theo MST) và điền luôn vào ô Khách hàng. Ô combobox tìm
 * phía server nên không còn giới hạn 200 khách hàng đầu như trước.
 */
function CustomerField({
  draft, onChange, onNewCustomer,
}: {
  draft: EditableDraft;
  onChange: (patch: Partial<EditableDraft>) => void;
  onNewCustomer: () => void;
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 300);
  const tax = normalizeTax(draft.buyerTaxCode);
  const debouncedTax = useDebounced(tax, 400);

  const remote = useQuery({
    queryKey: ['customer-pick', debouncedSearch],
    queryFn: async () => {
      const { data } = await api.get('/customers', {
        params: { search: debouncedSearch, pageSize: 20 },
      });
      return data.data as CustomerLite[];
    },
  });

  // Khớp chính xác theo MST
  const taxQuery = useQuery({
    queryKey: ['customer-by-tax', debouncedTax],
    queryFn: async () => {
      const { data } = await api.get('/customers', {
        params: { search: debouncedTax, pageSize: 20 },
      });
      const rows = data.data as CustomerLite[];
      return rows.find((c) => normalizeTax(c.taxCode) === debouncedTax) ?? null;
    },
    enabled: debouncedTax.length >= 8,
  });

  // Có MST khớp -> tự điền ô Khách hàng
  useEffect(() => {
    const hit = taxQuery.data;
    if (!hit) return;
    if (draft.customer?.id === hit.id) return;
    onChange({ customerId: hit.id, customer: hit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxQuery.data?.id]);

  const options: ComboOption[] = (remote.data ?? []).map((c) => ({
    value: String(c.id), label: c.name, hint: `MST ${c.taxCode}`,
  }));
  // Luôn giữ khách đang chọn trong danh sách để nhãn không bị mất
  if (draft.customer && !options.some((o) => o.value === String(draft.customer!.id))) {
    options.unshift({
      value: String(draft.customer.id),
      label: draft.customer.name,
      hint: `MST ${draft.customer.taxCode}`,
    });
  }

  const taxStatus: 'idle' | 'checking' | 'found' | 'notfound' =
    debouncedTax.length < 8
      ? 'idle'
      : taxQuery.isFetching
        ? 'checking'
        : taxQuery.data
          ? 'found'
          : 'notfound';

  // Khách đang chọn không khớp MST trong báo giá -> cảnh báo (không chặn xác nhận)
  const mismatch =
    taxStatus === 'idle'
      ? false
      : Boolean(draft.customer) && normalizeTax(draft.customer!.taxCode) !== debouncedTax;

  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <Field label="Mã số thuế" htmlFor={`tax-${draft.fileHash}`}>
          <Input
            id={`tax-${draft.fileHash}`}
            className="font-mono"
            value={draft.buyerTaxCode}
            onChange={(e) => onChange({ buyerTaxCode: e.target.value })}
            placeholder="0101234567"
          />
          {taxStatus === 'checking' && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Đang tìm theo MST…
            </p>
          )}
          {taxStatus === 'found' && (
            <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3 shrink-0" /> Đã có trong danh mục
            </p>
          )}
          {taxStatus === 'notfound' && (
            <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 shrink-0" /> Chưa có trong danh mục
            </p>
          )}
        </Field>

        <Field label="Khách hàng" htmlFor={`cust-${draft.fileHash}`} className="min-w-0">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Combobox
                id={`cust-${draft.fileHash}`}
                options={options}
                value={draft.customerId ? String(draft.customerId) : null}
                onChange={(v) => {
                  const picked = options.find((o) => o.value === v);
                  if (!picked) return;
                  const row = (remote.data ?? []).find((c) => String(c.id) === v);
                  const customer = row ?? {
                    id: Number(v),
                    name: picked.label,
                    taxCode: (picked.hint ?? '').replace(/^MST\s*/i, ''),
                  };
                  // Chọn khách hàng thì điền luôn MST của khách đó vào ô MST
                  onChange({ customerId: customer.id, customer, buyerTaxCode: customer.taxCode });
                }}
                onSearch={setSearch}
                loading={remote.isFetching}
                placeholder="Chọn khách hàng"
                searchPlaceholder="Tìm theo tên hoặc MST…"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={onNewCustomer}
              title="Tạo khách hàng mới từ thông tin trong báo giá"
              aria-label="Tạo khách hàng mới"
            >
              <Plus />
            </Button>
          </div>
          {draft.customerId === null ? (
            <p className="flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" /> Bắt buộc chọn khách hàng
            </p>
          ) : mismatch && taxStatus !== 'found' ? (
            <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 shrink-0" /> MST trong báo giá khác khách đang chọn
            </p>
          ) : null}
          {draft.buyerName && (
            <p className="truncate text-xs text-muted-foreground" title={draft.buyerName}>
              Trên báo giá: {draft.buyerName}
            </p>
          )}
        </Field>
      </div>

      {draft.customerCandidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Gợi ý:</span>
          {draft.customerCandidates.map((c) => {
            const active = draft.customerId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                title={`${c.name} · MST ${c.taxCode}`}
                aria-pressed={active}
                className={cn(
                  'inline-flex max-w-[280px] items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                  active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
                )}
                onClick={() => onChange({ customerId: c.id, customer: c, buyerTaxCode: c.taxCode })}
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{c.taxCode}</span>
              </button>
            );
          })}
        </div>
      )}

      <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={draft.rememberCustomer}
          onChange={(e) => onChange({ rememberCustomer: e.target.checked })}
        />
        Ghi nhớ tên trên báo giá cho khách hàng này
      </label>
    </div>
  );
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
  const [lookupStatus, setLookupStatus] = useState<string | null>(null);
  // Đánh dấu đã tra cứu thành công để lưu source = TAX_LOOKUP
  const [fromLookup, setFromLookup] = useState(false);

  // Mở lại cho file khác -> nạp lại dữ liệu đọc được từ báo giá
  useEffect(() => {
    if (!open) return;
    setTaxCode(initialTaxCode);
    setName(initialName);
    setAddress('');
    setEmail('');
    setBuyerName('');
    setNote(null);
    setLookupStatus(null);
    setFromLookup(false);
  }, [open, initialName, initialTaxCode]);

  const lookup = async () => {
    if (!taxCode.trim()) return;
    setLooking(true);
    setNote(null);
    setLookupStatus(null);
    try {
      const { data } = await api.post('/customers/lookup-tax', { taxCode: taxCode.trim() });
      // 1. Đã có trong danh mục -> không tạo trùng
      if (data.inDb) {
        setFromLookup(false);
        setNote('MST này đã có trong danh mục — chọn lại ở ô Khách hàng thay vì tạo mới.');
        return;
      }
      // 2. Tra cứu ngoài (VietQR) -> điền các trường còn lại
      if (data.found && data.info) {
        const info = data.info as {
          name?: string; address?: string; shortName?: string;
          internationalName?: string; status?: string;
        };
        if (info.name) setName(info.name);
        if (info.address) setAddress(info.address);
        setFromLookup(true);
        setLookupStatus(info.status ?? null);
        setNote(
          info.status
            ? `Đã điền thông tin từ tra cứu MST (${info.status}).`
            : 'Đã điền thông tin từ tra cứu MST.',
        );
        return;
      }
      setFromLookup(false);
      setNote(data.message ?? 'Không tra cứu được MST, vui lòng nhập tay.');
    } catch (e) {
      setFromLookup(false);
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
        source: fromLookup ? 'TAX_LOOKUP' : 'MANUAL',
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
      <div className="grid gap-4">
        <Field label="Mã số thuế" htmlFor="nc-mst">
          <div className="flex gap-2">
            <Input
              id="nc-mst"
              className="font-mono"
              value={taxCode}
              onChange={(e) => setTaxCode(e.target.value)}
              placeholder="0101234567"
            />
            <Button type="button" variant="outline" className="shrink-0" onClick={() => void lookup()} disabled={looking}>
              {looking ? <Loader2 className="animate-spin" /> : <SearchCheck />}
              Tra cứu
            </Button>
          </div>
          {lookupStatus && (
            <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> {lookupStatus}
            </p>
          )}
        </Field>
        <Field label="Tên đơn vị" htmlFor="nc-name">
          <Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Địa chỉ" htmlFor="nc-addr">
          <Input id="nc-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label="Người mua" htmlFor="nc-buyer">
            <Input id="nc-buyer" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="nc-email">
            <Input id="nc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        {note && (
          <p className="flex items-start gap-1.5 rounded-lg bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {note}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} Lưu khách hàng
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

/**
 * Ô mã hàng của một dòng báo giá.
 * Tìm kiếm phía server theo mã (model) trước — gõ "LT 040", "lt-040" hay "LT - 040"
 * đều ra nhóm LT-040-*; chọn xong thì tên hàng lấy từ danh mục và hiện ra ngay dưới ô.
 * Model không có trong danh mục mới cho tạo mới/nhập tay.
 */
function ProductField({
  id, line, onPick, onRememberChange,
}: {
  id: string;
  line: EditableLine;
  onPick: (p: MatchCandidate) => void;
  onRememberChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  // State riêng cho dialog tạo mã hàng — KHÔNG dùng chung với ô tìm kiếm,
  // nếu không thì gõ tìm kiếm sẽ bật dialog.
  const [createOpen, setCreateOpen] = useState(false);
  const debounced = useDebounced(search.trim(), 300);
  const query = debounced || line.parsed.model;

  const remote = useQuery({
    queryKey: ['product-pick', query],
    queryFn: async () => {
      const { data } = await api.get('/products', { params: { search: query, pageSize: 20 } });
      return data.data as MatchCandidate[];
    },
  });

  const options: ComboOption[] = (remote.data ?? []).map((p) => ({
    value: String(p.id), label: p.name, hint: [p.code, p.unit].filter(Boolean).join(' · '),
  }));
  // Luôn giữ mã đang chọn để nhãn không mất khi nằm ngoài trang kết quả
  if (line.product && !options.some((o) => o.value === String(line.product!.id))) {
    options.unshift({
      value: String(line.product.id),
      label: String(line.product.name),
      hint: [line.product.code, line.product.unit].filter(Boolean).join(' · '),
    });
  }

  const noMatch = Boolean(query) && !remote.isFetching && (remote.data ?? []).length === 0;
  // Ô chọn hiển thị TÊN hàng hóa; dòng mã đã khớp hiện riêng bên dưới để đối chiếu.
  const selectedCode = line.product?.code ?? '';
  const selectedUnit = line.product?.unit ?? '';

  return (
    <div className="min-w-0">
      <Combobox
        id={id}
        options={options}
        value={line.productId ? String(line.productId) : null}
        onChange={(v) => {
          const picked = (remote.data ?? []).find((p) => String(p.id) === v);
          if (picked) onPick(picked);
        }}
        onSearch={setSearch}
        loading={remote.isFetching}
        placeholder={line.parsed.model || line.parsed.name.slice(0, 24) || 'Chọn mã hàng'}
        searchPlaceholder="Tìm theo mã hàng…"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {line.productId !== null ? (
          <>
            {selectedCode && (
              <span className="truncate font-mono text-muted-foreground" title={selectedCode}>
                {selectedCode}{selectedUnit ? ` · ${selectedUnit}` : ''}
              </span>
            )}
            {line.parsed.model && (
              <label className="flex items-center gap-1.5 text-muted-foreground">
                <Checkbox
                  checked={line.remember}
                  onChange={(e) => onRememberChange(e.target.checked)}
                />
                Ghi nhớ “{line.parsed.model}”
              </label>
            )}
          </>
        ) : (
          <>
            <span className="text-destructive">
              {line.candidates.length > 0 ? 'Khớp nhiều mã, chọn một gợi ý' : 'Chưa ghép được mã hàng'}
            </span>
            {noMatch && (
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => setCreateOpen(true)}
              >
                + Tạo mã hàng
              </button>
            )}
          </>
        )}
      </div>
      {line.productId === null && (
        <NewProductDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialCode={line.parsed.model}
          initialName={line.parsed.name}
          initialUnit={line.parsed.unit}
          onCreated={(p) => {
            onPick(p);
            void qc.invalidateQueries({ queryKey: ['products'] });
            void qc.invalidateQueries({ queryKey: ['product-pick'] });
          }}
        />
      )}
    </div>
  );
}

/** Tạo mã hàng mới khi model trong báo giá chưa có trong danh mục. */
function NewProductDialog({
  open, onOpenChange, initialCode, initialName, initialUnit, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialCode: string;
  initialName: string;
  initialUnit: string;
  onCreated: (p: MatchCandidate) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState(initialUnit || 'Cái');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode(initialCode);
    setName(initialName);
    setUnit(initialUnit || 'Cái');
    setNote(null);
  }, [open, initialCode, initialName, initialUnit]);

  const save = async () => {
    if (!code.trim() || !name.trim() || !unit.trim()) {
      setNote('Cần nhập mã hàng, tên hàng và đơn vị tính.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/products', {
        code: code.trim(),
        name: name.trim(),
        unit: unit.trim(),
      });
      onCreated({ id: data.id, code: data.code, name: data.name, unit: data.unit });
      onOpenChange(false);
      toast.success(`Đã thêm mã hàng ${data.code}`);
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
      title="Thêm mã hàng"
      description="Model trong báo giá chưa có trong danh mục. Kiểm tra lại trước khi lưu."
    >
      <div className="grid gap-4">
        <Field label="Mã hàng *" htmlFor="np-code">
          <Input id="np-code" className="font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Tên hàng hóa *" htmlFor="np-name">
          <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Đơn vị tính *" htmlFor="np-unit">
          <Input id="np-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        {note && (
          <p className="flex items-start gap-1.5 rounded-lg bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {note}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} Lưu mã hàng
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

function DraftCard({
  draft, onChange, onLineChange, onRemove, canConfirm, onConfirm, onNewCustomer,
}: {
  draft: EditableDraft;
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

  const total = subtotal + vat;
  const lowConfidence = (l: EditableLine) => l.parsed.confidence === 'low';
  const unmatchedCount = draft.lines.filter((l) => l.productId === null).length;
  const issues: string[] = [];
  if (!draft.failed) {
    if (draft.customerId === null) issues.push('Chưa chọn khách hàng');
    if (unmatchedCount > 0) issues.push(`${unmatchedCount} dòng chưa ghép mã`);
    if (!draft.quoteNo.trim()) issues.push('Thiếu số báo giá');
    if (draft.lines.length === 0) issues.push('Chưa có dòng hàng');
  }

  const addLine = () =>
    onChange({
      lines: [
        ...draft.lines,
        {
          key: `n-${Date.now()}`,
          parsed: { line_no: draft.lines.length + 1, name: '', unit: '', qty: 1, unit_price: 0, amount: 0, model: '', brand: '', origin: '', spec_text: '', confidence: 'high' },
          productId: null, product: null, candidates: [], qty: 1, unitPrice: 0, taxRate: 0.08, remember: true,
        },
      ],
    });

  return (
    <div>
      {/* Thanh tiêu đề: tên file, trạng thái, thao tác */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold" title={draft.fileName}>{draft.fileName}</span>
          {draft.failed ? (
            <Badge variant="destructive">Lỗi đọc file</Badge>
          ) : canConfirm ? (
            <Badge variant="success">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Sẵn sàng
            </Badge>
          ) : (
            issues.map((m) => (
              <Badge key={m} variant="warning">{m}</Badge>
            ))
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          {!draft.failed && (
            <Button
              size="sm"
              variant={previewOpen ? 'default' : 'outline'}
              onClick={() => (previewOpen ? setPreviewOpen(false) : void openOriginal())}
              aria-pressed={previewOpen}
            >
              <FileUp /> {previewOpen ? 'Ẩn file gốc' : 'Xem file gốc'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Bỏ thẻ này">
            <X /> Bỏ
          </Button>
          <Button
            size="sm"
            disabled={!canConfirm || busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
            title={canConfirm ? undefined : issues.join(', ')}
          >
            {busy && <Loader2 className="animate-spin" />} Xác nhận
          </Button>
        </div>
      </div>

      {draft.failed ? (
        <div className="flex items-start gap-3 p-5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <p>{draft.failed.message}</p>
        </div>
      ) : (
        <div className={cn('grid', previewOpen && '2xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]')}>
          <div className="min-w-0 space-y-6 p-5">
            {draft.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                {draft.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            )}

            {/* Khách hàng & thông tin chứng từ */}
            <section className="space-y-3">
              <SectionTitle>Khách hàng</SectionTitle>
              <CustomerField draft={draft} onChange={onChange} onNewCustomer={onNewCustomer} />
              <div className="grid items-start gap-4 sm:grid-cols-2 md:grid-cols-[220px_220px]">
                <Field label="Số báo giá" htmlFor={`qno-${draft.fileHash}`}>
                  <Input
                    id={`qno-${draft.fileHash}`}
                    value={draft.quoteNo}
                    onChange={(e) => onChange({ quoteNo: e.target.value })}
                  />
                </Field>
                <Field label="Ngày báo giá" htmlFor={`qdate-${draft.fileHash}`}>
                  <Input
                    id={`qdate-${draft.fileHash}`}
                    type="date"
                    value={draft.quoteDate}
                    onChange={(e) => onChange({ quoteDate: e.target.value })}
                  />
                </Field>
              </div>
            </section>

            {/* Dòng hàng */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionTitle>Hàng hóa ({draft.lines.length})</SectionTitle>
                <Button variant="ghost" size="sm" onClick={addLine}>
                  <Plus /> Thêm dòng
                </Button>
              </div>
              <Table containerClassName="rounded-lg border" className="min-w-[760px]">
                  <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10 px-3 text-center">#</TableHead>
                      <TableHead className="px-3">Hàng hóa</TableHead>
                      <TableHead className="w-24 px-3 text-right">SL</TableHead>
                      <TableHead className="w-36 px-3 text-right">Đơn giá</TableHead>
                      <TableHead className="w-28 px-3">Thuế</TableHead>
                      <TableHead className="w-36 px-3 text-right">Thành tiền</TableHead>
                      <TableHead className="w-10 px-2" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.lines.map((l, i) => (
                      <TableRow
                        key={l.key}
                        className={cn(
                          // TableCell mặc định align-middle -> phải đặt align-top lên từng ô
                          '[&>td]:align-top',
                          l.productId === null ? 'bg-destructive/5' : lowConfidence(l) && 'bg-amber-500/5',
                        )}
                      >
                        <TableCell className="px-3 py-3 text-center text-xs tabular-nums leading-9 text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="px-3 py-3">
                          <ProductField
                            id={`prod-${draft.fileHash}-${i}`}
                            line={l}
                            onPick={(p) => onLineChange(i, { productId: p.id, product: p })}
                            onRememberChange={(remember) => onLineChange(i, { remember })}
                          />
                          {l.parsed.name && (
                            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground" title={l.parsed.name}>
                              <span className="font-medium">Báo giá:</span> {l.parsed.name}
                            </p>
                          )}
                          {l.candidates.length > 0 && l.productId !== l.candidates[0]!.id && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              <span className="text-[11px] text-muted-foreground">Gợi ý:</span>
                              {l.candidates.slice(0, 3).map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  title={c.name}
                                  className={cn(
                                    'rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-colors',
                                    l.productId === c.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
                                  )}
                                  onClick={() => onLineChange(i, { productId: c.id, product: c })}
                                >
                                  {c.code}
                                </button>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <Input
                            type="number"
                            step="any"
                            aria-label="Số lượng"
                            className="px-2 text-right tabular-nums"
                            value={l.qty ?? ''}
                            onChange={(e) => onLineChange(i, { qty: e.target.value ? Number(e.target.value) : null })}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <Input
                            type="number"
                            step="1"
                            aria-label="Đơn giá"
                            className="px-2 text-right tabular-nums"
                            value={l.unitPrice ?? ''}
                            onChange={(e) => onLineChange(i, { unitPrice: e.target.value ? Number(e.target.value) : null })}
                          />
                          {l.unitPrice != null && l.unitPrice >= 1000 && (
                            <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
                              {formatMoney(l.unitPrice)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <NativeSelect
                            aria-label="Thuế suất"
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
                          </NativeSelect>
                        </TableCell>
                        <TableCell className="px-3 py-3 text-right font-medium tabular-nums leading-9">
                          {formatMoney((l.qty ?? 0) * (l.unitPrice ?? 0))}
                        </TableCell>
                        <TableCell className="px-2 py-3">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Xóa dòng"
                            onClick={() => onChange({ lines: draft.lines.filter((_, j) => j !== i) })}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {draft.lines.length === 0 && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="px-4 py-3 text-center text-muted-foreground">
                          Chưa có dòng hàng. Bấm “Thêm dòng” để nhập.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
              </Table>
            </section>

            {/* Tổng tiền: so sánh số tính lại với số ghi trên báo giá */}
            <section className="ml-auto w-full max-w-md rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-6 gap-y-2">
                <span />
                <span className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">Tính lại</span>
                <span className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">Trên báo giá</span>
                <TotalRow label="Tổng chưa VAT" value={subtotal} declared={draft.declared.subtotal} />
                <TotalRow label="VAT" value={vat} declared={draft.declared.vat} />
                <div className="col-span-3 border-t" />
                <TotalRow label="Tổng thanh toán" value={total} declared={draft.declared.total} strong />
              </div>
            </section>
          </div>

          {previewOpen && (
            <aside className="min-w-0 border-t bg-muted/30 p-3 2xl:border-l 2xl:border-t-0">
              <div className="2xl:sticky 2xl:top-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">File gốc</span>
                  <div className="flex items-center gap-2">
                    {previewUrl && (
                      <Button asChild variant="ghost" size="sm">
                        <a href={previewUrl} target="_blank" rel="noreferrer">Mở tab mới</a>
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setPreviewOpen(false)}>
                      Đóng
                    </Button>
                  </div>
                </div>
                {!previewUrl && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tải file…
                  </p>
                )}
                {previewUrl && isPdf && (
                  <iframe
                    src={previewUrl}
                    title={`Xem trước ${draft.fileName}`}
                    className="h-[70vh] w-full rounded-lg border bg-white"
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
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

/** Một dòng tổng: số tính lại từ các dòng hàng và số ghi trên báo giá; lệch > 1đ thì tô vàng. */
function TotalRow({
  label, value, declared, strong,
}: {
  label: string; value: number; declared: number | null; strong?: boolean;
}) {
  const diff = declared != null && Math.abs(declared - value) > 1;
  return (
    <>
      <span className={cn(strong ? 'font-semibold' : 'text-muted-foreground')}>{label}</span>
      <CountUpMoney
        value={value}
        className={cn('text-right tabular-nums', strong && 'text-base font-semibold text-primary')}
      />
      <span
        className={cn(
          'text-right tabular-nums',
          diff ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
        )}
        title={diff ? 'Lệch với số tính lại từ các dòng hàng' : undefined}
      >
        {declared != null ? formatMoney(declared) : '—'}
        {diff && <AlertTriangle className="ml-1 inline h-3 w-3" />}
      </span>
    </>
  );
}
