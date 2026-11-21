/**
 * Gọi LLM qua chuỗi dự phòng. Mọi nhà cung cấp (Gemini, OpenRouter, OpenAI
 * Compatible, Anthropic) do quản trị viên cấu hình trong DB tại màn hình
 * Quản trị → AI Agent; không đọc key/model từ biến môi trường.
 *
 * Mỗi lần thử có timeout riêng; model lỗi liên tiếp bị "cầu dao" tạm ngắt để lần
 * sau không phải chờ lại. Không bao giờ throw: trả null khi không có provider,
 * AI bị tắt, hoặc mọi lựa chọn thất bại.
 */
import { logger } from '../lib/logger.js';
import {
  aiGlobalEnabled,
  listProviderRows,
  resolveBaseUrl,
  splitModels,
  type AiProviderKind,
  type AiProviderRow,
} from './ai-providers.js';

// Mở ngay sau lần lỗi đầu: rate-limit/quota hỏng thường lặp lại ngay, chờ
// lần thứ hai chỉ tổ làm người dùng đợi thêm mỗi lần tải báo giá.
const OPEN_AFTER_FAILS = 1;
const COOLDOWN_MS = 120_000;

interface Breaker {
  fails: number;
  openUntil: number;
}

const breakers = new Map<string, Breaker>();

export interface Provider {
  name: string;
  run(prompt: string, signal: AbortSignal): Promise<string>;
}

export interface ProviderConfig {
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

async function errorDetail(res: Response): Promise<string> {
  const detail = await res.text().catch(() => '');
  return `HTTP ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ''}`;
}

/** Google Gemini (generateContent). `baseUrl` mặc định là .../v1beta. */
async function runGemini(
  baseUrl: string,
  model: string,
  key: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${trimBase(baseUrl)}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 800, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${model}) ${(await res.text().catch(() => '')).slice(0, 140)}`);
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new Error('Phản hồi rỗng');
  return text;
}

/** OpenAI Compatible (/chat/completions) và OpenRouter. */
async function runOpenAiCompatible(
  baseUrl: string,
  model: string,
  key: string,
  prompt: string,
  signal: AbortSignal,
  opts: { openRouter?: boolean } = {},
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (opts.openRouter) headers['X-Title'] = 'IdleInvoice';
  const res = await fetch(`${trimBase(baseUrl)}/chat/completions`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`${model}: ${await errorDetail(res)}`);
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  const text = body.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error(body.error?.message ?? 'Phản hồi rỗng');
  return text;
}

/** Anthropic Messages API (/messages). */
async function runAnthropic(
  baseUrl: string,
  model: string,
  key: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(`${trimBase(baseUrl)}/messages`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`${model}: ${await errorDetail(res)}`);
  const body = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };
  const text = (body.content ?? [])
    .filter((b) => b.type === 'text' || typeof b.text === 'string')
    .map((b) => b.text ?? '')
    .join('');
  if (!text.trim()) throw new Error(body.error?.message ?? 'Phản hồi rỗng');
  return text;
}

function runByKind(
  cfg: ProviderConfig & { model: string },
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const base = resolveBaseUrl(cfg.kind, cfg.baseUrl);
  switch (cfg.kind) {
    case 'gemini':
      return runGemini(base, cfg.model, cfg.apiKey, prompt, signal);
    case 'anthropic':
      return runAnthropic(base, cfg.model, cfg.apiKey, prompt, signal);
    case 'openrouter':
      return runOpenAiCompatible(base, cfg.model, cfg.apiKey, prompt, signal, { openRouter: true });
    case 'openai':
    default:
      return runOpenAiCompatible(base, cfg.model, cfg.apiKey, prompt, signal);
  }
}

function providersForRow(row: AiProviderRow): Provider[] {
  const cfg: ProviderConfig = {
    kind: row.kind,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: row.model,
  };
  return splitModels(row.model).map((model) => ({
    name: `${row.kind}/${model}`,
    run: (prompt, signal) => runByKind({ ...cfg, model }, prompt, signal),
  }));
}

/** Provider đọc từ cấu hình DB do quản trị viên nhập (màn hình AI Agent). */
export function aiProviders(): Provider[] {
  let rows: AiProviderRow[] = [];
  try {
    rows = listProviderRows();
  } catch (err) {
    logger.warn({ err }, 'Không đọc được cấu hình AI trong DB');
    return [];
  }
  return rows.filter((r) => r.enabled === 1).flatMap(providersForRow);
}

export function aiEnabled(): boolean {
  return aiGlobalEnabled() && aiProviders().length > 0;
}

function isOpen(name: string): boolean {
  const b = breakers.get(name);
  return Boolean(b && b.openUntil > Date.now());
}

function recordFail(name: string): void {
  const b = breakers.get(name) ?? { fails: 0, openUntil: 0 };
  b.fails += 1;
  if (b.fails >= OPEN_AFTER_FAILS) {
    b.openUntil = Date.now() + COOLDOWN_MS;
    b.fails = 0;
  }
  breakers.set(name, b);
}

function recordOk(name: string): void {
  breakers.delete(name);
}

export interface CompletionResult {
  text: string;
  /** Tên provider/model thực tế đã trả lời, vd "gemini/gemini-2.5-flash". */
  provider: string;
}

/**
 * Chạy lần lượt các provider còn "đóng" cầu dao cho tới khi một cái trả lời.
 * Mỗi lần thử bị cắt sau `attemptTimeoutMs`; toàn bộ dừng khi quá `deadline`.
 */
export async function aiCompleteWithProvider(
  prompt: string,
  deadline: number,
): Promise<CompletionResult | null> {
  const timeoutMs = numEnv('AI_ATTEMPT_TIMEOUT_MS', 10_000);
  for (const provider of aiProviders()) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;
    if (isOpen(provider.name)) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
    try {
      const text = await provider.run(prompt, controller.signal);
      recordOk(provider.name);
      return { text, provider: provider.name };
    } catch (err) {
      recordFail(provider.name);
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ provider: provider.name, err: msg }, 'AI provider thất bại, thử model kế tiếp');
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export async function aiComplete(prompt: string, deadline: number): Promise<string | null> {
  const result = await aiCompleteWithProvider(prompt, deadline);
  return result?.text ?? null;
}

const TEST_PROMPT = 'Trả về đúng JSON sau, không giải thích: {"ok":true}';

/** Kiểm tra một cấu hình trước khi lưu (thử lần lượt từng model). */
export async function testProviderConfig(
  cfg: ProviderConfig,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; message: string; model?: string; latencyMs: number }> {
  const models = splitModels(cfg.model);
  const started = Date.now();
  let lastError = 'Không có model để kiểm tra';
  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const startedOne = Date.now();
      const text = await runByKind({ ...cfg, model }, TEST_PROMPT, controller.signal);
      if (!text.trim()) throw new Error('Phản hồi rỗng');
      return {
        ok: true,
        model,
        latencyMs: Date.now() - startedOne,
        message: `Kết nối thành công với ${model}`,
      };
    } catch (err) {
      lastError =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Hết thời gian chờ'
            : err.message
          : String(err);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, message: lastError, latencyMs: Date.now() - started };
}

/** Tải danh sách model công khai của provider (dùng cho gợi ý trong form). */
export async function fetchProviderModels(cfg: ProviderConfig, timeoutMs = 15_000): Promise<string[]> {
  const base = resolveBaseUrl(cfg.kind, cfg.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (cfg.kind === 'gemini') {
      const res = await fetch(`${base}/models?pageSize=200`, {
        signal: controller.signal,
        headers: { 'x-goog-api-key': cfg.apiKey },
      });
      if (!res.ok) throw new Error(await errorDetail(res));
      const body = (await res.json()) as { models?: Array<{ name?: string }> };
      return (body.models ?? [])
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter((m) => m && !m.includes('embedding') && !m.includes('aqa'))
        .sort();
    }

    if (cfg.kind === 'anthropic') {
      const res = await fetch(`${base}/models?limit=100`, {
        signal: controller.signal,
        headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      });
      if (!res.ok) throw new Error(await errorDetail(res));
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      return (body.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    }

    const res = await fetch(`${base}/models`, {
      signal: controller.signal,
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    if (!res.ok) throw new Error(await errorDetail(res));
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (body.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    return cfg.kind === 'openrouter'
      ? ids.sort((a, b) => Number(b.endsWith(':free')) - Number(a.endsWith(':free')))
      : ids.sort();
  } finally {
    clearTimeout(timer);
  }
}

/** Bóc JSON từ phản hồi LLM (chấp nhận có bọc ```json hoặc lời dẫn thừa). */
export function extractJson<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Tranh thủ chạy các tác vụ AI song song nhưng có giới hạn. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Dùng cho test: xóa trạng thái cầu dao. */
export const __aiInternals = { breakers, OPEN_AFTER_FAILS, COOLDOWN_MS };
