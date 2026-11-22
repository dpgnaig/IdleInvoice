import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlertTriangle, Bot, Building2, CheckCircle2, FileText, FileUp, Info,
  Loader2, Package, Plus, SearchCheck, Trash2, UploadCloud, X, XCircle,
} from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { api, apiErrorMessage } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { cn, formatMoney, todayIso } from '@/lib/utils';
import { CardPattern, PageHeader } from '@/components/layout/page-header';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { CountUpMoney } from '@/components/ui/count-up';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface PreviewSheet { name: string; rows: string[][] }
interface PreviewDoc { kind: 'excel' | 'word' | 'pdf' | string; sheets: PreviewSheet[]; paragraphs: string[] }

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
  ai?: { ran: boolean; lines: number; notes: string[]; providers?: string[] } | null;
  customerSuggestion?: { taxCode: string; name: string; address: string; status?: string; source: string } | null;
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
  /** Khách AI tìm thấy ngoài danh mục (VietQR) — gợi ý thêm vào DSKH. */
  customerSuggestion: { taxCode: string; name: string; address: string; status?: string } | null;
  aiNotes: string[];
  /** Provider/model AI đã thực sự trả lời cho file này. */
  aiProviders: string[];
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

const STAGES = [
  { key: 'parsing', label: 'Đọc file' },
  { key: 'matching', label: 'Ghép danh mục' },
  { key: 'fuzzy', label: 'Tìm tương tự (rapidfuzz)' },
  { key: 'ai', label: 'AI đối chiếu' },
  { key: 'tax_lookup', label: 'Tra MST' },
] as const;

const STAGE_LABEL: Record<string, string> = {
  queued: 'Trong hàng đợi',
  uploading: 'Đang tải lên',
  parsing: 'Đang đọc dữ liệu file',
  matching: 'Đang ghép khách hàng & mã hàng',
  fuzzy: 'Đang tìm tương tự (rapidfuzz)',
  ai: 'AI đang đối chiếu',
  tax_lookup: 'Đang tra cứu MST',
  done: 'Hoàn tất',
  error: 'Lỗi',
};

interface JobFileView { name: string; stage: string; pct: number; message?: string; aiProviders?: string[] }
interface JobView { id: string; status: 'running' | 'done'; files: JobFileView[]; drafts?: Draft[] }

export default function QuoteImportPage() {
  const qc = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const [uploadPatternSeed] = useState(() => Math.random().toString(36).slice(2));
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadNames, setUploadNames] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [newCustomerFor, setNewCustomerFor] = useState<number | null>(null);
  const [viewTab, setViewTab] = useState<'processing' | 'all' | 'ok' | 'need'>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const jobQuery = useQuery({
    queryKey: ['quote-job', jobId],
    enabled: Boolean(jobId),
    queryFn: async () => {
      if (!jobId) throw new Error('Thiếu mã phiên xử lý');
      const { data } = await api.get(endpoints.quotes.job(jobId));
      return data as JobView;
    },
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 700 : false),
  });
  const job = jobQuery.data;
  // Theo dõi file đã đưa vào danh sách / đã báo lỗi — để hiện NGAY từng báo giá
  // vừa đọc xong (không đợi cả lô), và không hiện/toast trùng ở lần poll sau.
  const seenHashes = useRef<Set<string>>(new Set());
  const erroredNames = useRef<Set<string>>(new Set());

  // Mỗi lần poll: file nào vừa xong thì đưa vào danh sách chỉnh sửa ngay lập tức
  useEffect(() => {
    if (!job) return;
    const incoming = (job.drafts ?? []).filter((d) => !seenHashes.current.has(d.fileHash));
    if (incoming.length) {
      incoming.forEach((d) => seenHashes.current.add(d.fileHash));
      setDrafts((prev) => [...prev, ...incoming.map(toEditable)]);
      for (const d of incoming) {
        if (d.status === 'failed') toast.error(`${d.originalName}: ${d.message ?? 'Không đọc được file'}`);
      }
    }
    // Lỗi bất ngờ (không sinh draft) vẫn phải báo ngay, không đợi cả phiên xong
    for (const f of job.files) {
      if (f.stage === 'error' && !erroredNames.current.has(f.name) && !incoming.some((d) => d.originalName === f.name)) {
        erroredNames.current.add(f.name);
        toast.error(`${f.name}: ${f.message ?? 'Lỗi xử lý file'}`);
      }
    }
  }, [job]);

  // Cả phiên xong -> dọn trạng thái tải lên + tóm tắt, rồi chuyển khỏi tab "Đang xử lý"
  // (lỗi từng file đã toast ngay lúc xong ở effect trên, không lặp lại ở đây)
  useEffect(() => {
    if (!job || job.status !== 'done' || !jobId) return;
    const ok = job.files.filter((f) => f.stage === 'done').length;
    if (ok > 1) toast.success(`Đọc xong ${ok} báo giá`);
    setJobId(null);
    setUploadNames([]);
    seenHashes.current = new Set();
    erroredNames.current = new Set();
    setViewTab((t) => (t === 'processing' ? 'all' : t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, job?.status]);

  useEffect(() => {
    if (!jobQuery.isError) return;
    toast.error(apiErrorMessage(jobQuery.error));
    setJobId(null);
    setUploadNames([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobQuery.isError]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files).filter((f) => /\.(pdf|xls|xlsx|docx)$/i.test(f.name));
    if (!arr.length) { toast.error('Chỉ hỗ trợ file .pdf, .xlsx, .xls, .docx'); return; }
    const fd = new FormData();
    arr.forEach((f) => fd.append('files', f));
    setUploading(true);
    setUploadPct(0);
    setUploadNames(arr.map((f) => f.name));
    setViewTab('processing');
    try {
      const { data } = await api.post(endpoints.quotes.parse, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => setUploadPct(e.total ? Math.round((e.loaded / e.total) * 100) : 40),
      });
      setJobId(data.jobId as string);
    } catch (e) {
      toast.error(apiErrorMessage(e));
      setUploadNames([]);
    } finally {
      setUploading(false);
    }
  }, []);

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
    !d.failed && d.customerId !== null &&
    d.lines.length > 0 && d.lines.every((l) => l.productId !== null && (l.qty ?? 0) > 0);

  const confirmOne = async (d: EditableDraft) => {
    await api.post(endpoints.quotes.confirm, {
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
  const needCount = drafts.length - readyCount;
  const showProcessing = uploading || Boolean(jobId && (!job || job.status === 'running'));

  // File đang xử lý: loại các file đã có draft (đọc xong, dù OK hay lỗi) —
  // file đó đã chuyển hẳn sang tab Báo giá, không hiện trùng ở tab Đang xử lý.
  const draftFileNames = new Set(drafts.map((d) => d.fileName));
  const processingFiles: JobFileView[] = (
    job?.files ?? uploadNames.map((name) => ({ name, stage: uploading ? 'uploading' : 'queued', pct: uploadPct }))
  ).filter((f) => !draftFileNames.has(f.name));

  // Tab "Đang xử lý" tự ẩn khi không còn file nào đang chạy; đang đứng ở đó thì
  // chuyển sang "Tất cả" để không đứng ở một tab rỗng.
  useEffect(() => {
    if (!showProcessing && viewTab === 'processing') setViewTab('all');
  }, [showProcessing, viewTab]);

  const TABS = [
    { key: 'processing' as const, label: 'Đang xử lý', count: processingFiles.length, show: showProcessing },
    { key: 'all' as const, label: 'Tất cả', count: drafts.length, show: true },
    { key: 'ok' as const, label: 'Sẵn sàng xác nhận', count: readyCount, show: true },
    { key: 'need' as const, label: 'Cần kiểm tra', count: needCount, show: true },
  ].filter((t) => t.show);

  const visibleDrafts = drafts
    .map((d, idx) => ({ d, idx }))
    .filter(({ d }) => viewTab === 'all' || viewTab === 'processing' || (viewTab === 'ok' ? canConfirm(d) : !canConfirm(d)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Nhập báo giá"
        description="Đọc PDF/Excel/Word, ghép khách hàng và mã hàng, AI kiểm tra lại rồi bạn xác nhận."
      />

      {/* Vùng kéo-thả: luôn hiện, thu gọn lại khi đã có nội dung để nhường chỗ cho danh sách */}
      <motion.label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files); }}
        animate={dragging ? { scale: 1.004 } : { scale: 1 }}
        className={cn(
          'relative block cursor-pointer overflow-hidden rounded-2xl p-[1.5px] shadow-sm transition-shadow',
          dragging ? 'ring-2 ring-primary/30' : '',
        )}
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[300%] w-[300%]"
          style={{
            x: '-50%',
            y: '-50%',
            background:
              'conic-gradient(from 0deg, transparent 0deg, hsl(var(--primary)) 70deg, hsl(var(--primary) / 0.25) 140deg, transparent 220deg, hsl(var(--primary) / 0.6) 300deg, transparent 360deg)',
          }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: dragging ? 1.6 : 5, ease: 'linear' }}
        />
        <div className="relative overflow-hidden rounded-[14.5px] bg-card">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-sky-500/5" />
        <CardPattern seed={uploadPatternSeed} compact />
        <div
          className={cn(
            'relative flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left',
            drafts.length > 0 || processingFiles.length > 0 ? 'px-5 py-4' : 'px-6 py-8',
          )}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <UploadCloud className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {drafts.length > 0 || processingFiles.length > 0 ? 'Tải thêm báo giá' : 'Kéo thả báo giá vào đây'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              PDF, Excel hoặc Word · tối đa 50 file mỗi lần · 10 MB mỗi file
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-end">
            {['PDF', 'XLSX', 'XLS', 'DOCX'].map((f) => (
              <span key={f} className="rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {f}
              </span>
            ))}
            <span className="ml-1 inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-sm">
              <FileUp className="h-4 w-4" /> Chọn file
            </span>
          </div>
        </div>
        {dragging && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-primary"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ repeat: Infinity, duration: 1.6 }}
          />
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.xlsx,.xls,.docx"
          className="sr-only"
          onChange={(e) => { void handleFiles(e.target.files); e.target.value = ''; }}
        />
        </div>
      </motion.label>

      {(drafts.length > 0 || processingFiles.length > 0) && (
        <div className="space-y-4">
          {/* Tab bar: mỗi khu vực chỉ hiện MỘT loại nội dung — đang xử lý HOẶC báo giá đã xong,
              không còn skeleton và thẻ thật trộn lẫn trong cùng một danh sách. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 shadow-sm">
            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Chế độ xem báo giá">
              {TABS.map((t) => {
                const active = viewTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setViewTab(t.key)}
                    className={cn(
                      'relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                      active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {t.key === 'processing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t.key === 'ok' && <CheckCircle2 className="h-3.5 w-3.5" />}
                    {t.key === 'need' && <AlertTriangle className="h-3.5 w-3.5" />}
                    {t.label}
                    <span className={cn('rounded-full px-1.5 text-[10px]', active ? 'bg-primary/15' : 'bg-muted')}>
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>
            {viewTab !== 'processing' && (
              <Button
                size="sm"
                disabled={readyCount === 0 || confirmAll.isPending}
                onClick={() => void confirmAll.mutateAsync()}
              >
                {confirmAll.isPending && <Loader2 className="animate-spin" />}
                Xác nhận tất cả ({readyCount})
              </Button>
            )}
          </div>

          {viewTab === 'processing' ? (
            <div className="space-y-5">
              {processingFiles.map((f, i) => (
                <DraftSkeleton key={`${f.name}-${i}`} file={f} />
              ))}
              {processingFiles.length === 0 && (
                <div className="rounded-xl border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                  Không còn file nào đang xử lý.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {visibleDrafts.length === 0 && (
                <div className="rounded-xl border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                  {drafts.length === 0
                    ? 'Chưa có báo giá nào — đang chờ đọc xong file vừa tải lên.'
                    : `Không có báo giá nào ở mục "${viewTab === 'ok' ? 'Sẵn sàng xác nhận' : 'Cần kiểm tra'}".`}
                </div>
              )}
              <AnimatePresence>
                {visibleDrafts.map(({ d, idx }) => (
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
            </div>
          )}
        </div>
      )}

      <NewCustomerDialog
        open={newCustomerFor !== null}
        onOpenChange={(v) => !v && setNewCustomerFor(null)}
        initialName={newCustomerFor !== null ? drafts[newCustomerFor]?.buyerName ?? '' : ''}
        initialTaxCode={newCustomerFor !== null ? drafts[newCustomerFor]?.buyerTaxCode ?? '' : ''}
        initialAddress={newCustomerFor !== null ? drafts[newCustomerFor]?.customerSuggestion?.address ?? '' : ''}
        onCreated={(c) => {
          const idx = newCustomerFor;
          void qc.invalidateQueries({ queryKey: ['customers-all'] });
          void qc.invalidateQueries({ queryKey: ['customers'] });
          void qc.invalidateQueries({ queryKey: ['customer-options'] });
          if (idx !== null) {
            updateDraft(idx, {
              customerId: c.id,
              customer: c,
              buyerTaxCode: c.taxCode,
              customerSuggestion: null,
              rememberCustomer: true,
            });
          }
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
      customer: null, customerCandidates: [], customerSuggestion: null, aiNotes: [], aiProviders: [],
      rememberCustomer: true, warnings: [], lines: [],
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
    customerSuggestion: d.customerSuggestion ?? null,
    aiNotes: d.ai?.notes ?? [],
    aiProviders: d.ai?.providers ?? [],
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
  const tax = normalizeTax(draft.buyerTaxCode);

  // Nạp toàn bộ danh mục một lần; combobox tự lọc + cuộn ảo phía client.
  const all = useQuery({
    queryKey: ['customer-options'],
    queryFn: async () => {
      const { data } = await api.get(endpoints.customers.options);
      return data as CustomerLite[];
    },
    staleTime: 5 * 60_000,
  });
  const customers = all.data ?? [];

  // Khớp chính xác theo MST trên toàn bộ danh mục (không giới hạn theo trang)
  const taxHit = useMemo(
    () =>
      tax.length >= 8
        ? customers.find((c) => normalizeTax(c.taxCode) === tax) ?? null
        : null,
    [customers, tax],
  );

  // Có MST khớp -> tự điền ô Khách hàng
  useEffect(() => {
    if (!taxHit) return;
    if (draft.customer?.id === taxHit.id) return;
    onChange({ customerId: taxHit.id, customer: taxHit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxHit?.id]);

  const options = useMemo<ComboOption[]>(() => {
    const base: ComboOption[] = customers.map((c) => ({
      value: String(c.id), label: c.name, hint: `MST ${c.taxCode}`,
      code: c.taxCode, keywords: `${c.taxCode} ${c.name}`,
    }));
    // Luôn giữ khách đang chọn trong danh sách để nhãn không bị mất
    if (draft.customer && !base.some((o) => o.value === String(draft.customer!.id))) {
      base.unshift({
        value: String(draft.customer.id),
        label: draft.customer.name,
        hint: `MST ${draft.customer.taxCode}`,
      });
    }
    return base;
  }, [customers, draft.customer]);

  const taxStatus: 'idle' | 'checking' | 'found' | 'notfound' =
    tax.length < 8
      ? 'idle'
      : all.isLoading
        ? 'checking'
        : taxHit
          ? 'found'
          : 'notfound';

  // Khách đang chọn không khớp MST trong báo giá -> cảnh báo (không chặn xác nhận)
  const mismatch =
    taxStatus === 'idle'
      ? false
      : Boolean(draft.customer) && normalizeTax(draft.customer!.taxCode) !== tax;

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
                  const row = customers.find((c) => String(c.id) === v);
                  const customer = row ?? {
                    id: Number(v),
                    name: picked.label,
                    taxCode: (picked.hint ?? '').replace(/^MST\s*/i, ''),
                  };
                  // Chọn khách hàng thì điền luôn MST của khách đó vào ô MST
                  onChange({ customerId: customer.id, customer, buyerTaxCode: customer.taxCode });
                }}
                loading={all.isLoading}
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

      {draft.customerSuggestion && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2">
          <div className="min-w-0 text-xs">
            <p className="truncate font-medium" title={draft.customerSuggestion.name}>
              Tra cứu MST: {draft.customerSuggestion.name}
            </p>
            <p className="truncate text-muted-foreground">
              MST {draft.customerSuggestion.taxCode}
              {draft.customerSuggestion.address ? ` · ${draft.customerSuggestion.address}` : ''}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onChange({ buyerTaxCode: draft.customerSuggestion!.taxCode });
              onNewCustomer();
            }}
          >
            <Plus /> Thêm vào DSKH
          </Button>
        </div>
      )}

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
  open, onOpenChange, initialName, initialTaxCode, initialAddress, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialName: string;
  initialTaxCode: string;
  initialAddress?: string;
  onCreated: (c: { id: number; name: string; taxCode: string }) => void;
}) {
  const [taxCode, setTaxCode] = useState(initialTaxCode);
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialAddress ?? '');
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
    setAddress(initialAddress ?? '');
    setEmail('');
    setBuyerName('');
    setNote(null);
    setLookupStatus(null);
    setFromLookup(false);
  }, [open, initialName, initialTaxCode, initialAddress]);

  const lookup = async () => {
    if (!taxCode.trim()) return;
    setLooking(true);
    setNote(null);
    setLookupStatus(null);
    try {
      const { data } = await api.post(endpoints.customers.lookupTax, { taxCode: taxCode.trim() });
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
      const { data } = await api.post(endpoints.customers.list, {
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
  // State riêng cho dialog tạo mã hàng — KHÔNG dùng chung với ô tìm kiếm,
  // nếu không thì gõ tìm kiếm sẽ bật dialog.
  const [createOpen, setCreateOpen] = useState(false);

  // Nạp toàn bộ danh mục hàng hóa một lần; combobox tự lọc + cuộn ảo phía client.
  const all = useQuery({
    queryKey: ['product-options'],
    queryFn: async () => {
      const { data } = await api.get(endpoints.products.options);
      return data as MatchCandidate[];
    },
    staleTime: 5 * 60_000,
  });
  const products = all.data ?? [];

  const options = useMemo<ComboOption[]>(() => {
    const base: ComboOption[] = products.map((p) => ({
      value: String(p.id), label: p.name, hint: [p.code, p.unit].filter(Boolean).join(' · '),
      code: p.code, keywords: `${p.code} ${p.name} ${p.unit}`,
    }));
    // Luôn giữ mã đang chọn để nhãn không mất khi nằm ngoài danh sách
    if (line.product && !base.some((o) => o.value === String(line.product!.id))) {
      base.unshift({
        value: String(line.product.id),
        label: String(line.product.name),
        hint: [line.product.code, line.product.unit].filter(Boolean).join(' · '),
      });
    }
    return base;
  }, [products, line.product]);

  // Model đọc từ báo giá không có trong danh mục -> gợi ý tạo mã mới
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const modelKey = norm(line.parsed.model);
  const noMatch =
    Boolean(modelKey) &&
    !all.isLoading &&
    !products.some((p) => norm(p.code).includes(modelKey) || norm(p.name).includes(modelKey));
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
          const picked = products.find((p) => String(p.id) === v);
          if (picked) onPick(picked);
        }}
        loading={all.isLoading}
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
            void qc.invalidateQueries({ queryKey: ['product-options'] });
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
      const { data } = await api.post(endpoints.products.list, {
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

/** Thẻ chờ cho một báo giá đang đọc — giữ chỗ đúng kích thước thẻ thật để không nhảy layout. */
function DraftSkeleton({ file }: { file: JobFileView }) {
  const stageIndex = STAGES.findIndex((s) => s.key === file.stage);
  const failed = file.stage === 'error';
  const done = file.stage === 'done';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      aria-busy="true"
      className="overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div className="border-b bg-muted/20 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                failed ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
              )}
            >
              {failed ? <XCircle className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={file.name}>
                {file.name}
              </p>
              <p className={cn('mt-1 flex items-center gap-1.5 text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}>
                {failed ? (
                  <XCircle className="h-3 w-3" />
                ) : done ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                )}
                {STAGE_LABEL[file.stage] ?? file.stage}
                <span className="tabular-nums">· {Math.max(0, Math.min(100, file.pct))}%</span>
              </p>
            </div>
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div
            className={cn('h-full', failed ? 'bg-destructive' : done ? 'bg-emerald-500' : 'bg-primary')}
            animate={{ width: `${Math.max(4, Math.min(100, file.pct))}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 24 }}
          />
        </div>
        {stageIndex >= 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {STAGES.map((s, idx) => (
              <span
                key={s.key}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  idx < stageIndex
                    ? 'text-muted-foreground'
                    : idx === stageIndex
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground/50',
                )}
              >
                {s.label}
              </span>
            ))}
          </div>
        )}
        {file.aiProviders && file.aiProviders.length > 0 && (
          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-sky-700 dark:text-sky-400">
            <Bot className="h-3 w-3 shrink-0" /> AI: {file.aiProviders.join(' · ')}
          </p>
        )}
        {file.message && <p className="mt-1.5 text-xs text-destructive">{file.message}</p>}
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="overflow-hidden rounded-xl border">
          <div className="border-b bg-muted/20 px-4 py-2.5">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-3/4" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border">
          <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-2.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
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
  const [sheetPreview, setSheetPreview] = useState<PreviewDoc | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const isPdf = /\.pdf$/i.test(draft.fileName);

  const openOriginal = async () => {
    try {
      setPreviewOpen(true);
      if (previewUrl || sheetPreview) return;
      if (isPdf) {
        const res = await api.get(endpoints.quotes.file(draft.fileHash), { responseType: 'blob' });
        setPreviewUrl(URL.createObjectURL(res.data as Blob));
        return;
      }
      // Excel/Word: lấy dữ liệu thô từ parser, hiển thị như trình xem
      setPreviewLoading(true);
      const res = await api.get(endpoints.quotes.preview(draft.fileHash));
      setSheetPreview(res.data as PreviewDoc);
    } catch (e) {
      setPreviewOpen(false);
      toast.error(apiErrorMessage(e));
    } finally {
      setPreviewLoading(false);
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
      {/* Thanh tiêu đề: tên file, trạng thái, provider AI, thao tác */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              draft.failed ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
            )}
          >
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={draft.fileName}>{draft.fileName}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {draft.failed ? (
                <Badge variant="destructive">Lỗi đọc file</Badge>
              ) : canConfirm ? (
                <Badge variant="success">
                  <CheckCircle2 className="h-3 w-3" /> Sẵn sàng
                </Badge>
              ) : (
                issues.map((m) => (
                  <Badge key={m} variant="warning">{m}</Badge>
                ))
              )}
              {draft.aiProviders.map((p) => (
                <Badge key={p} variant="info" className="font-mono text-[10px]">
                  <Bot className="h-3 w-3" /> {p}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {!draft.failed && (
            <Button
              size="sm"
              variant={previewOpen ? 'default' : 'outline'}
              onClick={() => (previewOpen ? setPreviewOpen(false) : void openOriginal())}
              aria-pressed={previewOpen}
            >
              <FileUp /> {previewOpen ? 'Ẩn file gốc' : 'File gốc'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label="Bỏ thẻ này"
            className="text-muted-foreground hover:text-destructive"
          >
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
        <div>
          <div className="min-w-0 space-y-4 p-4 sm:p-5">
            {draft.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                {draft.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            )}

            {draft.aiNotes.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2">
                {draft.aiNotes.map((n, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-sky-700 dark:text-sky-400">
                    <SearchCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> AI: {n}
                  </li>
                ))}
              </ul>
            )}

            {/* Khách hàng & thông tin chứng từ */}
            <section className="overflow-hidden rounded-xl border">
              <div className="flex items-center gap-2 border-b bg-muted/20 px-4 py-2.5">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Thông tin báo giá</h3>
              </div>
              <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                <CustomerField draft={draft} onChange={onChange} onNewCustomer={onNewCustomer} />
                <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
                  <Field label="Số báo giá" htmlFor={`qno-${draft.fileHash}`}>
                    <Input
                      id={`qno-${draft.fileHash}`}
                      value={draft.quoteNo}
                      onChange={(e) => onChange({ quoteNo: e.target.value })}
                    />
                  </Field>
                  <Field label="Ngày báo giá" htmlFor={`qdate-${draft.fileHash}`}>
                    <DatePicker
                      id={`qdate-${draft.fileHash}`}
                      value={draft.quoteDate}
                      onChange={(v) => onChange({ quoteDate: v })}
                    />
                  </Field>
                </div>
              </div>
            </section>

            {/* Dòng hàng */}
            <section className="overflow-hidden rounded-xl border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Hàng hóa</h3>
                  <Badge variant="secondary">{draft.lines.length}</Badge>
                </div>
                <Button variant="outline" size="sm" onClick={addLine}>
                  <Plus /> Thêm dòng
                </Button>
              </div>
              <Table containerClassName="overflow-x-auto" className="min-w-[820px]">
                  <TableHeader>
                    <TableRow className="bg-transparent hover:bg-transparent">
                      <TableHead className="w-10 px-3 text-center text-[11px] uppercase tracking-wide">#</TableHead>
                      <TableHead className="px-3 text-[11px] uppercase tracking-wide">Hàng hóa</TableHead>
                      <TableHead className="w-20 px-2 text-right text-[11px] uppercase tracking-wide">SL</TableHead>
                      <TableHead className="w-32 px-2 text-right text-[11px] uppercase tracking-wide">Đơn giá</TableHead>
                      <TableHead className="w-24 px-2 text-[11px] uppercase tracking-wide">Thuế</TableHead>
                      <TableHead className="w-32 px-3 text-right text-[11px] uppercase tracking-wide">Thành tiền</TableHead>
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
                          l.productId === null ? 'bg-destructive/[0.04]' : lowConfidence(l) && 'bg-amber-500/[0.05]',
                        )}
                      >
                        <TableCell className="px-3 py-3 text-center text-xs tabular-nums leading-8 text-muted-foreground">{i + 1}</TableCell>
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
                          {(l.parsed.brand || l.parsed.model || l.parsed.origin || l.parsed.spec_text || l.parsed.unit) && (
                            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                              {l.parsed.brand && (
                                <>
                                  <dt className="text-muted-foreground/80">Hãng</dt>
                                  <dd className="truncate" title={l.parsed.brand}>{l.parsed.brand}</dd>
                                </>
                              )}
                              {l.parsed.model && (
                                <>
                                  <dt className="text-muted-foreground/80">Model</dt>
                                  <dd className="truncate font-mono" title={l.parsed.model}>{l.parsed.model}</dd>
                                </>
                              )}
                              {l.parsed.origin && (
                                <>
                                  <dt className="text-muted-foreground/80">Xuất xứ</dt>
                                  <dd className="truncate" title={l.parsed.origin}>{l.parsed.origin}</dd>
                                </>
                              )}
                              {l.parsed.unit && (
                                <>
                                  <dt className="text-muted-foreground/80">ĐVT</dt>
                                  <dd>{l.parsed.unit}</dd>
                                </>
                              )}
                              {l.parsed.spec_text && (
                                <>
                                  <dt className="text-muted-foreground/80">Mô tả</dt>
                                  <dd className="line-clamp-3 whitespace-pre-line" title={l.parsed.spec_text}>
                                    {l.parsed.spec_text}
                                  </dd>
                                </>
                              )}
                            </dl>
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
                        <TableCell className="px-2 py-3">
                          <Input
                            type="number"
                            step="any"
                            aria-label="Số lượng"
                            className="h-8 px-2 text-right tabular-nums"
                            value={l.qty ?? ''}
                            onChange={(e) => onLineChange(i, { qty: e.target.value ? Number(e.target.value) : null })}
                          />
                        </TableCell>
                        <TableCell className="px-2 py-3">
                          <Input
                            type="number"
                            step="1"
                            aria-label="Đơn giá"
                            className="h-8 px-2 text-right tabular-nums"
                            value={l.unitPrice ?? ''}
                            onChange={(e) => onLineChange(i, { unitPrice: e.target.value ? Number(e.target.value) : null })}
                          />
                          {l.unitPrice != null && l.unitPrice >= 1000 && (
                            <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
                              {formatMoney(l.unitPrice)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="px-2 py-3">
                          <NativeSelect
                            aria-label="Thuế suất"
                            selectClassName="h-8 text-xs"
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
                        <TableCell className="px-3 py-3 text-right font-medium tabular-nums leading-8">
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
              {/* Tổng tiền gắn liền bảng hàng: số tính lại so với số trên báo giá */}
              <div className="flex justify-end border-t bg-muted/20 p-4">
                <div className="w-full max-w-sm rounded-lg border bg-background p-4 text-sm shadow-sm">
                  <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-5 gap-y-2">
                    <span />
                    <span className="text-right text-[10px] uppercase tracking-wide text-muted-foreground">Tính lại</span>
                    <span className="text-right text-[10px] uppercase tracking-wide text-muted-foreground">Trên báo giá</span>
                    <TotalRow label="Tổng chưa VAT" value={subtotal} declared={draft.declared.subtotal} />
                    <TotalRow label="VAT" value={vat} declared={draft.declared.vat} />
                    <div className="col-span-3 border-t" />
                    <TotalRow label="Tổng thanh toán" value={total} declared={draft.declared.total} strong />
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* File gốc mở trong dialog riêng — không chen vào làm vỡ bố cục thông tin báo giá */}
      {!draft.failed && (
        <Dialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={`File gốc — ${draft.fileName}`}
          className="max-w-5xl"
        >
          <div className="max-h-[78vh] space-y-3 overflow-auto">
            <div className="flex items-center justify-end gap-2">
              {previewUrl && (
                <Button asChild variant="outline" size="sm">
                  <a href={previewUrl} target="_blank" rel="noreferrer">Mở tab mới</a>
                </Button>
              )}
            </div>
            {!previewUrl && !sheetPreview && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {previewLoading ? 'Đang đọc nội dung file…' : 'Đang tải file…'}
              </p>
            )}
            {previewUrl && isPdf && (
              <iframe
                src={previewUrl}
                title={`Xem trước ${draft.fileName}`}
                className="h-[70vh] w-full rounded-lg border bg-white"
              />
            )}
            {sheetPreview && <SheetPreviewDoc doc={sheetPreview} />}
          </div>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Xem trước Excel/Word giống trình xem PDF: tab theo sheet, bảng cuộn được,
 * số dòng đánh ở cột đầu để dễ đối chiếu với bản đã ghép.
 */
function SheetPreviewDoc({ doc }: { doc: PreviewDoc }) {
  const [tab, setTab] = useState(0);
  const sheet = doc.sheets[tab];
  const isWord = doc.kind === 'word';
  return (
    <div className="space-y-2">
      {doc.sheets.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {doc.sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              type="button"
              onClick={() => setTab(i)}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] transition-colors',
                i === tab ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
              )}
            >
              {s.name || `Sheet ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-[70vh] overflow-auto rounded-lg border bg-background">
        {isWord && doc.paragraphs.length > 0 && (
          <div className="space-y-1 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {doc.paragraphs.slice(0, 40).map((p, i) => (
              <p key={i} className="break-words">{p}</p>
            ))}
          </div>
        )}
        {sheet && sheet.rows.length > 0 ? (
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r} className={r % 2 ? 'bg-muted/30' : undefined}>
                  <td className="w-8 select-none border-r border-b px-1.5 py-1 text-right text-muted-foreground">
                    {r + 1}
                  </td>
                  {row.map((cell, c) => (
                    <td key={c} className="max-w-[280px] border-b px-1.5 py-1 align-top break-words">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-xs text-muted-foreground">Không có dữ liệu để hiển thị.</p>
        )}
      </div>
    </div>
  );
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
