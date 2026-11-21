import { Router } from 'express';
import { z } from 'zod';
import { writeAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { asyncHandler } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { fetchProviderModels, testProviderConfig } from '../services/ai.js';
import {
  BACKUP_PASSPHRASE_MIN,
  decryptAiConfig,
  exportAiConfig,
  restoreAiConfig,
} from '../services/ai-backup.js';
import {
  AI_KIND_LIST,
  aiGlobalEnabled,
  createProviderRow,
  deleteProviderRow,
  getProviderRow,
  listProviderRows,
  publicProvider,
  resolveBaseUrl,
  setAiGlobalEnabled,
  updateProviderRow,
} from '../services/ai-providers.js';

export const aiProvidersRouter: Router = Router();
aiProvidersRouter.use(requireRole('admin'));

const kindSchema = z.enum(['gemini', 'openrouter', 'openai', 'anthropic']);

const baseUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), 'Base URL phải bắt đầu bằng http:// hoặc https://')
  .default('');

const providerInput = z.object({
  name: z.string().trim().min(1, 'Tên không được để trống').max(80),
  kind: kindSchema,
  baseUrl: baseUrlSchema,
  model: z.string().trim().min(1, 'Cần ít nhất một model').max(500),
  apiKey: z.string().trim().max(1000).optional().default(''),
  enabled: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

aiProvidersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      data: listProviderRows().map(publicProvider),
      enabled: aiGlobalEnabled(),
      kinds: AI_KIND_LIST,
    });
  }),
);

aiProvidersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = providerInput.parse(req.body);
    const row = createProviderRow(body);
    writeAudit(req.user!.id, 'create', 'ai_provider', row.id, { kind: row.kind, model: row.model });
    res.status(201).json({ data: publicProvider(row) });
  }),
);

aiProvidersRouter.patch(
  '/enabled',
  asyncHandler(async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    setAiGlobalEnabled(enabled);
    writeAudit(req.user!.id, 'update', 'ai_setting', 'enabled', { enabled });
    res.json({ enabled: aiGlobalEnabled() });
  }),
);

/* ---------- Sao lưu / khôi phục cấu hình (JSON mã hóa) ---------- */

aiProvidersRouter.post(
  '/backup',
  asyncHandler(async (req, res) => {
    const { passphrase } = z
      .object({ passphrase: z.string().min(BACKUP_PASSPHRASE_MIN, `Mật khẩu phải có ít nhất ${BACKUP_PASSPHRASE_MIN} ký tự`) })
      .parse(req.body);
    const content = exportAiConfig(passphrase);
    writeAudit(req.user!.id, 'export', 'ai_config', 'backup', {
      providers: listProviderRows().length,
    });
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.json({ filename: `ai-config-${date}.json`, content });
  }),
);

aiProvidersRouter.post(
  '/restore',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        passphrase: z.string().min(1, 'Nhập mật khẩu của file sao lưu'),
        content: z.string().min(1, 'Chưa có nội dung file sao lưu').max(2_000_000),
      })
      .parse(req.body);
    const config = decryptAiConfig(body.content, body.passphrase);
    const result = restoreAiConfig(config);
    writeAudit(req.user!.id, 'restore', 'ai_config', 'restore', result);
    res.json({ ok: true, ...result });
  }),
);

/* ---------- Đổi thứ tự ưu tiên ---------- */

aiProvidersRouter.patch(
  '/reorder',
  asyncHandler(async (req, res) => {
    const { ids } = z
      .object({ ids: z.array(z.number().int().positive()).min(1).max(200) })
      .parse(req.body);
    const existing = listProviderRows();
    const known = new Set(existing.map((r) => r.id));
    const unique = new Set(ids);
    if (ids.length !== existing.length || unique.size !== ids.length || ids.some((id) => !known.has(id))) {
      throw badRequest('Danh sách thứ tự không khớp cấu hình hiện tại');
    }
    ids.forEach((id, i) => updateProviderRow(id, { sortOrder: (i + 1) * 10 }));
    writeAudit(req.user!.id, 'reorder', 'ai_provider', 'all', { ids });
    res.json({ data: listProviderRows().map(publicProvider) });
  }),
);

const idParam = z.coerce.number().int().positive();

aiProvidersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = providerInput.partial().parse(req.body);
    if (!Object.keys(body).length) throw badRequest('Không có thay đổi nào');
    const row = updateProviderRow(id, body);
    if (!row) throw notFound('Không tìm thấy nhà cung cấp AI');
    writeAudit(req.user!.id, 'update', 'ai_provider', id, { kind: row.kind, model: row.model });
    res.json({ data: publicProvider(row) });
  }),
);

aiProvidersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam.parse(req.params.id);
    if (!deleteProviderRow(id)) throw notFound('Không tìm thấy nhà cung cấp AI');
    writeAudit(req.user!.id, 'delete', 'ai_provider', id, {});
    res.json({ ok: true });
  }),
);

const testInput = providerInput.extend({ providerId: z.coerce.number().int().positive().optional() });

aiProvidersRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    const body = testInput.parse(req.body);
    let apiKey = body.apiKey;
    // Cho phép kiểm tra bằng key đã lưu: form không bao giờ nhận lại key thật
    if (!apiKey && body.providerId) {
      apiKey = getProviderRow(body.providerId)?.apiKey ?? '';
    }
    // Server OpenAI-compatible chạy nội bộ (Ollama, vLLM…) thường không cần key
    if (!apiKey && body.kind !== 'openai') throw badRequest('Chưa có API key để kiểm tra');
    const result = await testProviderConfig({
      kind: body.kind,
      baseUrl: body.baseUrl,
      apiKey,
      model: body.model,
    });
    res.json(result);
  }),
);

aiProvidersRouter.post(
  '/models',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        kind: kindSchema,
        baseUrl: baseUrlSchema,
        apiKey: z.string().trim().max(1000).optional().default(''),
        providerId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.body);
    let apiKey = q.apiKey;
    if (!apiKey && q.providerId) apiKey = getProviderRow(q.providerId)?.apiKey ?? '';
    try {
      const models = await fetchProviderModels({
        kind: q.kind,
        baseUrl: resolveBaseUrl(q.kind, q.baseUrl),
        apiKey,
        model: '',
      });
      res.json({ models });
    } catch (err) {
      res.status(502).json({
        error: 'Không tải được danh sách model',
        details: [{ message: err instanceof Error ? err.message : String(err) }],
      });
    }
  }),
);
