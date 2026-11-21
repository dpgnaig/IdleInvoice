import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot,
  Download,
  GripVertical,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RadioTower,
  RefreshCw,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Field, Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

type Kind = 'gemini' | 'openrouter' | 'openai' | 'anthropic';

interface KindInfo {
  value: Kind;
  label: string;
  baseUrl: string;
  hint: string;
  models: string[];
}

interface ProviderRow {
  id: number;
  name: string;
  kind: Kind;
  baseUrl: string;
  model: string;
  enabled: boolean;
  hasKey: boolean;
  apiKeyMasked: string;
}

interface ProvidersResponse {
  data: ProviderRow[];
  enabled: boolean;
  kinds: KindInfo[];
}

/** Dùng chung cho trang và prefetch từ màn Quản trị để chuyển tab không bị chờ. */
export async function fetchAiProviders(): Promise<ProvidersResponse> {
  const { data } = await api.get<ProvidersResponse>(endpoints.admin.aiProviders.list);
  return data;
}

interface FormState {
  id?: number;
  name: string;
  kind: Kind;
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
}

interface TestResult {
  ok: boolean;
  message: string;
  model?: string;
  latencyMs: number;
}

const emptyForm = (kinds: KindInfo[]): FormState => {
  const first = kinds[0];
  return {
    name: first?.label ?? '',
    kind: first?.value ?? 'gemini',
    baseUrl: first?.baseUrl ?? '',
    model: '',
    apiKey: '',
    enabled: true,
  };
};

export default function AiSettingsPage({
  embedded = false,
  embeddedToolbar,
}: {
  embedded?: boolean;
  /** Khi nhúng vào tab Quản trị: tab chuyển mục được đặt chung hàng với các nút thao tác. */
  embeddedToolbar?: ReactNode;
}) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm([]));
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<ProviderRow | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupPass, setBackupPass] = useState('');
  const [backupPass2, setBackupPass2] = useState('');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restorePass, setRestorePass] = useState('');
  const [restoreContent, setRestoreContent] = useState('');
  const [restoreName, setRestoreName] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [orderedRows, setOrderedRows] = useState<ProviderRow[] | null>(null);

  const providers = useQuery({
    queryKey: ['ai-providers'],
    queryFn: fetchAiProviders,
  });

  const kinds = providers.data?.kinds ?? [];
  const activeCount = providers.data?.data.filter((p) => p.enabled && p.hasKey).length ?? 0;

  // Thứ tự lạc quan khi kéo-thả; dữ liệu server về thì dùng lại thứ tự đã lưu
  useEffect(() => {
    setOrderedRows(null);
  }, [providers.dataUpdatedAt]);

  const toggleGlobal = useMutation({
    mutationFn: async (enabled: boolean) =>
      api.patch(endpoints.admin.aiProviders.enabled, { enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai-providers'] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const body = {
        name: f.name,
        kind: f.kind,
        baseUrl: f.baseUrl,
        model: f.model,
        apiKey: f.apiKey,
        enabled: f.enabled,
      };
      return f.id
        ? api.patch(endpoints.admin.aiProviders.byId(f.id), body)
        : api.post(endpoints.admin.aiProviders.list, body);
    },
    onSuccess: () => {
      toast.success('Đã lưu nhà cung cấp AI');
      setDialogOpen(false);
      void qc.invalidateQueries({ queryKey: ['ai-providers'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(endpoints.admin.aiProviders.byId(id)),
    onSuccess: () => {
      toast.success('Đã xóa nhà cung cấp');
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['ai-providers'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleRow = useMutation({
    mutationFn: async (row: ProviderRow) =>
      api.patch(endpoints.admin.aiProviders.byId(row.id), { enabled: !row.enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai-providers'] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const reorder = useMutation({
    mutationFn: async (ids: number[]) => api.patch(endpoints.admin.aiProviders.reorder, { ids }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai-providers'] }),
    onError: (e) => {
      toast.error(apiErrorMessage(e));
      void qc.invalidateQueries({ queryKey: ['ai-providers'] });
    },
  });

  const backup = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ filename: string; content: string }>(
        endpoints.admin.aiProviders.backup,
        { passphrase: backupPass },
      );
      return data;
    },
    onSuccess: ({ filename, content }) => {
      const href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast.success('Đã tải file sao lưu mã hóa');
      setBackupOpen(false);
      setBackupPass('');
      setBackupPass2('');
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const restore = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ providers: number }>(endpoints.admin.aiProviders.restore, {
        passphrase: restorePass,
        content: restoreContent,
      });
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Đã khôi phục ${data.providers} nhà cung cấp AI`);
      setRestoreOpen(false);
      setRestorePass('');
      setRestoreContent('');
      setRestoreName('');
      setOrderedRows(null);
      void qc.invalidateQueries({ queryKey: ['ai-providers'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  const openCreate = () => {
    setForm(emptyForm(kinds.length ? kinds : [{ value: 'gemini', label: 'Google Gemini', baseUrl: '', hint: '', models: [] } as KindInfo]));
    setModelOptions([]);
    setTestResult(null);
    setDialogOpen(true);
  };

  const openEdit = (row: ProviderRow) => {
    setForm({
      id: row.id,
      name: row.name,
      kind: row.kind,
      baseUrl: row.baseUrl,
      model: row.model,
      apiKey: '',
      enabled: row.enabled,
    });
    const info = kinds.find((k) => k.value === row.kind);
    setModelOptions(info?.models ?? []);
    setTestResult(null);
    setDialogOpen(true);
  };

  const onKindChange = (value: Kind) => {
    const info = kinds.find((k) => k.value === value);
    const prev = kinds.find((k) => k.value === form.kind);
    const keepBase = form.baseUrl && form.baseUrl !== prev?.baseUrl;
    setForm((f) => ({
      ...f,
      kind: value,
      name: f.name === prev?.label ? (info?.label ?? value) : f.name,
      baseUrl: keepBase ? f.baseUrl : (info?.baseUrl ?? ''),
      model: prev?.models.includes(f.model) || !f.model ? '' : f.model,
    }));
    setModelOptions(info?.models ?? []);
    setTestResult(null);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post<TestResult>(endpoints.admin.aiProviders.test, {
        name: form.name || 'test',
        kind: form.kind,
        baseUrl: form.baseUrl,
        model: form.model,
        providerId: form.id,
        apiKey: form.apiKey,
      });
      setTestResult(data);
      if (data.ok) toast.success(`Kết nối OK (${data.latencyMs} ms)`);
      else toast.error(data.message);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const loadModels = async () => {
    setLoadingModels(true);
    try {
      const { data } = await api.post<{ models: string[] }>(endpoints.admin.aiProviders.models, {
        kind: form.kind,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        providerId: form.id,
      });
      setModelOptions(data.models);
      toast.success(`Đã tải ${data.models.length} model`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setLoadingModels(false);
    }
  };

  const selectedKind = kinds.find((k) => k.value === form.kind);
  const suggestions = [...new Set([...modelOptions, ...(selectedKind?.models ?? [])])];
  const modelList = form.model.split(',').map((m) => m.trim()).filter(Boolean);
  const setModelList = (list: string[]) =>
    setForm((f) => ({ ...f, model: [...new Set(list.map((m) => m.trim()).filter(Boolean))].join(', ') }));
  const modelChoices = suggestions
    .filter((m) => !modelList.includes(m))
    .map((m) => ({ value: m, label: m }));

  const rows = orderedRows ?? providers.data?.data ?? [];
  const canReorder = !reorder.isPending && !orderedRows;

  const moveRow = (target: number) => {
    if (dragIndex === null || dragIndex === target) {
      setDragIndex(null);
      return;
    }
    const next = [...rows];
    const [moved] = next.splice(dragIndex, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setOrderedRows(next);
    setDragIndex(null);
    reorder.mutate(next.map((r) => r.id));
  };

  const actions = (
    <>
      <Button variant="outline" onClick={() => setRestoreOpen(true)} disabled={providers.isLoading}>
        <Upload /> Khôi phục
      </Button>
      <Button variant="outline" onClick={() => setBackupOpen(true)} disabled={providers.isLoading}>
        <Download /> Sao lưu
      </Button>
      <Button onClick={openCreate}>
        <Plus /> Thêm nhà cung cấp
      </Button>
    </>
  );

  return (
    <div>
      {embedded ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>{embeddedToolbar}</div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      ) : (
        <PageHeader
          title="AI Agent"
          description="Cấu hình nhà cung cấp mô hình cho bước bổ sung báo giá."
          actions={actions}
        />
      )}

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Bổ sung bằng AI</p>
                <Badge variant={providers.data?.enabled ? 'success' : 'secondary'}>
                  {providers.data?.enabled ? 'Đang bật' : 'Đang tắt'}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {activeCount > 0
                  ? `${activeCount} nhà cung cấp sẵn sàng, chạy lần lượt theo thứ tự bên dưới; provider lỗi bị tạm ngắt 2 phút.`
                  : 'Chưa có nhà cung cấp nào bật và có API key — AI sẽ không chạy.'}
              </p>
            </div>
          </div>
          <Button
            variant={providers.data?.enabled ? 'outline' : 'default'}
            disabled={toggleGlobal.isPending || !providers.data}
            onClick={() => toggleGlobal.mutate(!providers.data?.enabled)}
          >
            {toggleGlobal.isPending && <Loader2 className="animate-spin" />}
            {providers.data?.enabled ? 'Tắt AI' : 'Bật AI'}
          </Button>
        </CardContent>
      </Card>

      {providers.isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Đang tải cấu hình…
          </CardContent>
        </Card>
      ) : (providers.data?.data.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            title="Chưa cấu hình nhà cung cấp AI"
            description="Thêm Google Gemini, OpenRouter, hoặc bất kỳ API tương thích OpenAI/Anthropic. Không có cấu hình nào thì báo giá vẫn được xử lý bằng bộ ghép tất định."
            action={<Button onClick={openCreate}><Plus /> Thêm nhà cung cấp</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          <p className="text-xs text-muted-foreground">
            Kéo tay nắm bên trái để đổi thứ tự ưu tiên; provider ở trên được gọi trước.
          </p>
          {rows.map((row, index) => (
            <Card
              key={row.id}
              onDragOver={(e) => { if (canReorder) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (canReorder) moveRow(index); }}
              className={cn('transition-opacity', dragIndex === index && 'opacity-50')}
            >
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    draggable={canReorder}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(index));
                      setDragIndex(index);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className={cn(
                      'mt-0.5 flex h-8 w-6 shrink-0 items-center justify-center rounded text-muted-foreground',
                      canReorder ? 'cursor-grab hover:bg-muted active:cursor-grabbing' : 'opacity-40',
                    )}
                    title="Kéo để đổi thứ tự ưu tiên"
                    aria-label="Kéo để đổi thứ tự ưu tiên"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-xs font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <Badge variant="outline">{kinds.find((k) => k.value === row.kind)?.label ?? row.kind}</Badge>
                      {!row.enabled && <Badge variant="secondary">Đang tắt</Badge>}
                      {row.enabled && !row.hasKey && <Badge variant="warning">Thiếu API key</Badge>}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{row.model}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <RadioTower className="h-3 w-3 shrink-0" />
                      {row.baseUrl || kinds.find((k) => k.value === row.kind)?.baseUrl}
                      <span className="inline-flex items-center gap-1 pl-2">
                        <KeyRound className="h-3 w-3 shrink-0" />
                        {row.hasKey ? row.apiKeyMasked : 'chưa có'}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleRow.mutate(row)}
                    disabled={toggleRow.isPending}
                  >
                    <Zap /> {row.enabled ? 'Tắt' : 'Bật'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(row)}>
                    <Pencil /> Sửa
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(row)}>
                    <Trash2 /> Xóa
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Nội dung báo giá (tên công ty, thông số hàng hoá) được gửi tới nhà cung cấp model khi AI bật.
        API key lưu trong cơ sở dữ liệu cục bộ và không bao giờ trả về trình duyệt.
      </p>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={form.id ? 'Sửa nhà cung cấp AI' : 'Thêm nhà cung cấp AI'}
        description="Chọn loại API; Base URL được điền sẵn theo loại và có thể đổi."
        className="max-w-xl"
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Loại API" htmlFor="ai-kind">
              <NativeSelect
                id="ai-kind"
                value={form.kind}
                onChange={(e) => onKindChange(e.target.value as Kind)}
              >
                {kinds.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Tên hiển thị" htmlFor="ai-name">
              <Input
                id="ai-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="VD: Gemini cá nhân"
              />
            </Field>
          </div>

          <Field
            label="Base URL"
            htmlFor="ai-base"
            hint={selectedKind?.hint}
          >
            <Input
              id="ai-base"
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              placeholder={selectedKind?.baseUrl}
              spellCheck={false}
            />
          </Field>

          <Field label="Model" htmlFor="ai-model" hint="Thêm một hoặc nhiều model; các model thử lần lượt để dự phòng.">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  id="ai-model"
                  options={modelChoices}
                  value={null}
                  onChange={(_v, opt) => setModelList([...modelList, opt.value])}
                  placeholder="Chọn hoặc nhập tên model…"
                  searchPlaceholder="Tìm hoặc nhập model…"
                  allowCustom
                  customHint="Thêm model vừa nhập"
                  emptyText="Nhập tên model rồi Enter"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadModels()}
                disabled={loadingModels || !form.baseUrl}
                title="Tải danh sách model từ provider"
              >
                {loadingModels ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Model
              </Button>
            </div>
            {modelList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {modelList.map((m) => (
                  <Badge key={m} variant="secondary" className="gap-1 font-mono text-[11px]">
                    {m}
                    <button
                      type="button"
                      aria-label={`Bỏ ${m}`}
                      className="rounded-sm opacity-60 transition-opacity hover:opacity-100"
                      onClick={() => setModelList(modelList.filter((x) => x !== m))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </Field>

          <Field
            label="API key"
            htmlFor="ai-key"
            hint={form.id ? 'Bỏ trống để giữ key đã lưu. Key không hiển thị lại sau khi lưu.' : undefined}
          >
            <Input
              id="ai-key"
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={form.id ? 'Giữ nguyên key hiện tại' : 'sk-… / AIza…'}
            />
          </Field>

          <div className="flex items-center gap-2">
            <Checkbox
              id="ai-enabled"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            <Label htmlFor="ai-enabled" className="font-normal">Bật nhà cung cấp này</Label>
          </div>

          {testResult && (
            <div
              className={`rounded-md border px-3 py-2 text-xs ${
                testResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                  : 'border-destructive/30 bg-destructive/5 text-destructive'
              }`}
            >
              {testResult.ok ? 'OK' : 'Lỗi'}: {testResult.message}
              {testResult.ok ? ` (${testResult.latencyMs} ms)` : ''}
            </div>
          )}

          <DialogFooter className="flex-wrap justify-between gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => void runTest()} disabled={testing || !form.model}>
              {testing ? <Loader2 className="animate-spin" /> : <RadioTower />}
              Kiểm tra kết nối
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Hủy
              </Button>
              <Button
                type="button"
                onClick={() => save.mutate(form)}
                disabled={save.isPending || !form.name.trim() || !form.model.trim()}
              >
                {save.isPending && <Loader2 className="animate-spin" />}
                Lưu
              </Button>
            </div>
          </DialogFooter>
        </div>
      </Dialog>

      <Dialog
        open={backupOpen}
        onOpenChange={(v) => {
          setBackupOpen(v);
          if (!v) { setBackupPass(''); setBackupPass2(''); }
        }}
        title="Sao lưu cấu hình AI"
        description="File JSON chứa API key đã mã hóa AES-256-GCM; cần đúng mật khẩu để khôi phục."
      >
        <div className="grid gap-4">
          <Field
            label="Mật khẩu"
            htmlFor="bk-pass"
            hint="Tối thiểu 8 ký tự. Hệ thống không lưu mật khẩu — mất mật khẩu là không mở được file."
          >
            <Input
              id="bk-pass"
              type="password"
              autoComplete="new-password"
              value={backupPass}
              onChange={(e) => setBackupPass(e.target.value)}
            />
          </Field>
          <Field label="Nhập lại mật khẩu" htmlFor="bk-pass2">
            <Input
              id="bk-pass2"
              type="password"
              autoComplete="new-password"
              value={backupPass2}
              onChange={(e) => setBackupPass2(e.target.value)}
            />
          </Field>
          {backupPass2.length > 0 && backupPass !== backupPass2 && (
            <p className="text-xs text-destructive">Mật khẩu nhập lại không khớp.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBackupOpen(false)}>
              Hủy
            </Button>
            <Button
              type="button"
              onClick={() => backup.mutate()}
              disabled={
                backup.isPending || backupPass.length < 8 || backupPass !== backupPass2
              }
            >
              {backup.isPending ? <Loader2 className="animate-spin" /> : <Download />}
              Tải file sao lưu
            </Button>
          </DialogFooter>
        </div>
      </Dialog>

      <Dialog
        open={restoreOpen}
        onOpenChange={(v) => {
          setRestoreOpen(v);
          if (!v) { setRestorePass(''); setRestoreContent(''); setRestoreName(''); }
        }}
        title="Khôi phục cấu hình AI"
        description="Chọn file sao lưu JSON đã mã hóa và nhập mật khẩu đã dùng khi sao lưu."
        className="max-w-xl"
      >
        <div className="grid gap-4">
          <Field label="File sao lưu (.json)" htmlFor="rs-file">
            <Input
              id="rs-file"
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 2_000_000) {
                  toast.error('File quá lớn (tối đa 2 MB)');
                  e.target.value = '';
                  return;
                }
                setRestoreContent(await file.text());
                setRestoreName(file.name);
              }}
            />
          </Field>
          {restoreName && (
            <p className="text-xs text-muted-foreground">
              Đã chọn: <span className="font-mono">{restoreName}</span>
            </p>
          )}
          <Field label="Mật khẩu của file sao lưu" htmlFor="rs-pass">
            <Input
              id="rs-pass"
              type="password"
              autoComplete="current-password"
              value={restorePass}
              onChange={(e) => setRestorePass(e.target.value)}
            />
          </Field>
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Khôi phục sẽ thay thế toàn bộ nhà cung cấp AI và trạng thái bật/tắt hiện tại.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRestoreOpen(false)}>
              Hủy
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => restore.mutate()}
              disabled={restore.isPending || !restoreContent || !restorePass}
            >
              {restore.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              Khôi phục
            </Button>
          </DialogFooter>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Xóa nhà cung cấp AI?"
        description={deleting ? `"${deleting.name}" sẽ bị xóa khỏi chuỗi dự phòng. Thao tác không hoàn tác được.` : ''}
        confirmLabel="Xóa"
        destructive
        onConfirm={() => {
          if (deleting) return remove.mutateAsync(deleting.id).then(() => undefined);
        }}
      />
    </div>
  );
}
