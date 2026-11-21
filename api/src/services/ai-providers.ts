/**
 * Cấu hình nhà cung cấp AI lưu trong DB (màn hình Quản trị → AI Agent).
 * Chỉ mô tả dữ liệu và CRUD; việc gọi HTTP nằm ở `services/ai.ts`.
 */
import { asc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { aiProviders } from '../db/schema.js';
import { getSetting, setSetting } from '../lib/settings.js';

export type AiProviderKind = 'gemini' | 'openrouter' | 'openai' | 'anthropic';

export interface AiKindInfo {
  label: string;
  baseUrl: string;
  hint: string;
  models: string[];
}

/** Mặc định/giợi ý cho từng loại provider; dùng chung cho API và giao diện. */
export const AI_KINDS: Record<AiProviderKind, AiKindInfo> = {
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    hint: 'API key lấy từ Google AI Studio. Model dùng alias như gemini-flash-lite-latest.',
    models: ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    hint: 'Model free có hậu tố :free. Có thể nhập nhiều model, cách nhau dấu phẩy.',
    models: [
      'nvidia/nemotron-3.5-lightning:free',
      'google/gemma-4-31b-it:free',
      'inclusionai/ling-3.2-flash:free',
    ],
  },
  openai: {
    label: 'OpenAI Compatible',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'Bất kỳ server nào tương thích /chat/completions: OpenAI, Azure, Groq, vLLM, Ollama…',
    models: ['gpt-4o-mini', 'gpt-4.1-mini'],
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    hint: 'Dùng Messages API (/v1/messages) với header x-api-key.',
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
  },
};

export const AI_KIND_LIST = Object.entries(AI_KINDS).map(([value, info]) => ({
  value: value as AiProviderKind,
  ...info,
}));

export interface AiProviderRow {
  id: number;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Không bao giờ trả key thật ra ngoài; chỉ giữ 4 ký tự cuối để người dùng nhận ra. */
export function maskKey(key: string): string {
  if (!key) return '';
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

export function publicProvider(row: AiProviderRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    model: row.model,
    enabled: row.enabled === 1,
    hasKey: row.apiKey.length > 0,
    apiKeyMasked: maskKey(row.apiKey),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listProviderRows(): AiProviderRow[] {
  return getDb()
    .select()
    .from(aiProviders)
    .orderBy(asc(aiProviders.sortOrder), asc(aiProviders.id))
    .all() as AiProviderRow[];
}

export function getProviderRow(id: number): AiProviderRow | undefined {
  return getDb().select().from(aiProviders).where(eq(aiProviders.id, id)).get() as
    | AiProviderRow
    | undefined;
}

export function createProviderRow(input: {
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  sortOrder?: number;
}): AiProviderRow {
  const db = getDb();
  const now = new Date().toISOString();
  const maxOrder =
    db
      .select()
      .from(aiProviders)
      .orderBy(asc(aiProviders.sortOrder))
      .all()
      .reduce((max, r) => Math.max(max, r.sortOrder), 0) ?? 0;
  return db
    .insert(aiProviders)
    .values({
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      enabled: input.enabled ? 1 : 0,
      sortOrder: input.sortOrder ?? maxOrder + 10,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get() as AiProviderRow;
}

export function updateProviderRow(
  id: number,
  input: Partial<{
    name: string;
    kind: AiProviderKind;
    baseUrl: string;
    apiKey: string;
    model: string;
    enabled: boolean;
    sortOrder: number;
  }>,
): AiProviderRow | undefined {
  const existing = getProviderRow(id);
  if (!existing) return undefined;
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
  // Chuỗi rỗng = giữ key cũ (giao diện không bao giờ nhận lại key thật)
  if (input.apiKey) patch.apiKey = input.apiKey;
  if (input.model !== undefined) patch.model = input.model;
  if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  getDb().update(aiProviders).set(patch).where(eq(aiProviders.id, id)).run();
  return getProviderRow(id);
}

export function deleteProviderRow(id: number): boolean {
  const existing = getProviderRow(id);
  if (!existing) return false;
  getDb().delete(aiProviders).where(eq(aiProviders.id, id)).run();
  return true;
}

/** Công tắc chung của tính năng AI, lưu trong DB (màn hình AI Agent). */
export function aiGlobalEnabled(): boolean {
  return getSetting('ai_enabled') !== 'false';
}

export function setAiGlobalEnabled(enabled: boolean): void {
  setSetting('ai_enabled', enabled ? 'true' : 'false');
}

export function resolveBaseUrl(kind: AiProviderKind, baseUrl: string): string {
  return (baseUrl.trim() || AI_KINDS[kind].baseUrl).replace(/\/+$/, '');
}

export function splitModels(model: string): string[] {
  const list = model
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length ? list : AI_KINDS.openai.models.slice(0, 1);
}
