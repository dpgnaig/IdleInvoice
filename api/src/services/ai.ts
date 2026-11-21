/**
 * Gọi LLM free qua chuỗi dự phòng: Google AI Studio (Gemini) trước, rồi các
 * model free của OpenRouter. Mỗi lần thử có timeout riêng; model lỗi liên tiếp
 * bị "cầu dao" tạm ngắt để lần sau không phải chờ lại.
 *
 * Không bao giờ throw: trả null khi mọi lựa chọn thất bại/không cấu hình key.
 */
import { logger } from '../lib/logger.js';

// Mở ngay sau lần lỗi đầu: rate-limit/quota hỏng thường lặp lại ngay, chờ
// lần thứ hai chỉ tổ làm người dùng đợi thêm mỗi lần tải báo giá.
const OPEN_AFTER_FAILS = 1;
const COOLDOWN_MS = 120_000;

/**
 * Model free mặc định. OpenRouter thay đổi danh sách thường xuyên — nếu một
 * model bị gỡ (404), `discoverFreeModel` tự dò model free còn hiệu lực.
 */
const DEFAULT_OPENROUTER_MODELS = [
  'nvidia/nemotron-3.5-lightning:free',
  'google/gemma-4-31b-it:free',
  'inclusionai/ling-3.2-flash:free',
];

interface Breaker {
  fails: number;
  openUntil: number;
}

const breakers = new Map<string, Breaker>();

interface Provider {
  name: string;
  run(prompt: string, signal: AbortSignal): Promise<string>;
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Dùng Gemini của Google AI Studio. Nhận cả GEMINI_API_KEY và GOOGLE_AI_API_KEY.
 *
 * Google hay gỡ model cũ khỏi tài khoản mới (404), nên dùng alias
 * `gemini-flash-lite-latest` trước; chỉ khi gặp 404 mới thử model dự phòng
 * (429/quota thì chuyển ngay sang OpenRouter — chờ thêm chỉ làm chậm).
 */
function geminiProvider(): Provider[] {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!key) return [];
  const configured = (process.env.GEMINI_MODEL || '').trim();
  const models = [...new Set([configured || 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'])];

  return [
    {
      name: `gemini/${models[0]}`,
      async run(prompt, signal) {
        let lastErr: Error | null = null;
        for (const model of models) {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
              method: 'POST',
              signal,
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0, maxOutputTokens: 800, responseMimeType: 'application/json' },
              }),
            },
          );
          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            lastErr = new Error(`HTTP ${res.status} (${model}) ${detail.slice(0, 140)}`);
            if (res.status === 404) continue; // model bị gỡ -> thử model khác
            throw lastErr;
          }
          const body = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
          if (!text.trim()) throw new Error('Phản hồi rỗng');
          return text;
        }
        throw lastErr ?? new Error('Không có model Gemini khả dụng');
      },
    },
  ];
}

/** Danh sách model free OpenRouter (phân tách bằng dấu phẩy trong OPENROUTER_MODELS). */
function openRouterProviders(): Provider[] {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return [];
  const models = (process.env.OPENROUTER_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const list = models.length ? models : DEFAULT_OPENROUTER_MODELS;
  return list.map((model) => ({
    name: `openrouter/${model}`,
    async run(prompt: string, signal: AbortSignal) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'X-Title': 'IdleInvoice',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        // 404 = model đã bị gỡ/bỏ bản free -> thử tự dò model thay thế
        if (res.status === 404) {
          const fallback = await discoverFreeModel(key, signal);
          if (fallback) return fallback(prompt, signal);
        }
        throw new Error(`HTTP ${res.status} ${detail.slice(0, 160)}`);
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      const text = body.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) throw new Error(body.error?.message ?? 'Phản hồi rỗng');
      return text;
    },
  }));
}

/**
 * OpenRouter gỡ/bổ sung model free khá thường xuyên, nên danh sách mặc định sẽ
 * cũ dần. Khi gặp 404, hỏi /api/v1/models và lấy một model free còn hiệu lực
 * (ưu tiên model lớn) để dùng luôn cho các lần sau.
 */
let discovered: string | null = null;

async function discoverFreeModel(key: string, signal: AbortSignal): Promise<((p: string, s: AbortSignal) => Promise<string>) | null> {
  if (discovered) return makeRunner(key, discovered);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }>;
    };
    const free = (body.data ?? [])
      .filter((m) => m.id?.endsWith(':free') && m.pricing?.prompt === '0' && m.pricing?.completion === '0')
      .map((m) => m.id!);
    const pick = free.find((id) => id.includes('nemotron')) ?? free.find((id) => !id.includes('embedding')) ?? null;
    if (!pick) return null;
    discovered = pick;
    logger.warn({ model: pick }, 'OpenRouter: dùng model free tự dò được');
    return makeRunner(key, pick);
  } catch {
    return null;
  }
}

function makeRunner(key: string, model: string) {
  return async (prompt: string, signal: AbortSignal) => {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Title': 'IdleInvoice' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} (model tự dò ${model})`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw new Error('Phản hồi rỗng');
    return text;
  };
}

export function aiProviders(): Provider[] {
  return [...geminiProvider(), ...openRouterProviders()];
}

export function aiEnabled(): boolean {
  return process.env.AI_ENABLED !== 'false' && aiProviders().length > 0;
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

/**
 * Chạy lần lượt các provider còn "đóng" cầu dao cho tới khi một cái trả lời.
 * Mỗi lần thử bị cắt sau `attemptTimeoutMs`; toàn bộ dừng khi quá `deadline`.
 */
export async function aiComplete(prompt: string, deadline: number): Promise<string | null> {
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
      return text;
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
