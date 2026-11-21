/**
 * Sao lưu / khôi phục cấu hình AI thành file JSON mã hóa.
 * File chứa API key nên phải mã hóa: scrypt (KDF) + AES-256-GCM.
 * Không có mật khẩu thì không thể đọc, và sai mật khẩu sẽ hỏng auth tag.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb, getRawDb } from '../db/index.js';
import { aiProviders } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import {
  aiGlobalEnabled,
  createProviderRow,
  listProviderRows,
  setAiGlobalEnabled,
  type AiProviderKind,
} from './ai-providers.js';

export const AI_BACKUP_FORMAT = 'idleinvoice.ai-config';
export const AI_BACKUP_VERSION = 1;
export const BACKUP_PASSPHRASE_MIN = 8;

const providerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['gemini', 'openrouter', 'openai', 'anthropic']),
  baseUrl: z.string().max(300).default(''),
  apiKey: z.string().max(1000).default(''),
  model: z.string().trim().min(1).max(500),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const configSchema = z.object({
  enabled: z.boolean().default(true),
  providers: z.array(providerSchema).max(200),
});

export type AiConfigBackup = z.infer<typeof configSchema>;

const envelopeSchema = z.object({
  format: z.literal(AI_BACKUP_FORMAT),
  version: z.literal(AI_BACKUP_VERSION),
  kdf: z.literal('scrypt'),
  cipher: z.literal('aes-256-gcm'),
  salt: z.string().min(1),
  iv: z.string().min(1),
  tag: z.string().min(1),
  data: z.string().min(1),
});

function encrypt(plain: string, passphrase: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify(
    {
      format: AI_BACKUP_FORMAT,
      version: AI_BACKUP_VERSION,
      kdf: 'scrypt',
      cipher: 'aes-256-gcm',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: data.toString('base64'),
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

export function exportAiConfig(passphrase: string): string {
  if (passphrase.length < BACKUP_PASSPHRASE_MIN) {
    throw badRequest(`Mật khẩu phải có ít nhất ${BACKUP_PASSPHRASE_MIN} ký tự`);
  }
  const rows = listProviderRows();
  if (!rows.length) throw badRequest('Chưa có cấu hình AI để sao lưu');
  const payload: AiConfigBackup = {
    enabled: aiGlobalEnabled(),
    providers: rows.map((r) => ({
      name: r.name,
      kind: r.kind as AiProviderKind,
      baseUrl: r.baseUrl,
      apiKey: r.apiKey,
      model: r.model,
      enabled: r.enabled === 1,
      sortOrder: r.sortOrder,
    })),
  };
  return encrypt(JSON.stringify(configSchema.parse(payload)), passphrase);
}

export function decryptAiConfig(raw: string, passphrase: string): AiConfigBackup {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw badRequest('File sao lưu không phải JSON hợp lệ');
  }
  const env = envelopeSchema.safeParse(json);
  if (!env.success) throw badRequest('File sao lưu không đúng định dạng hoặc sai phiên bản');
  try {
    const key = crypto.scryptSync(passphrase, Buffer.from(env.data.salt, 'base64'), 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.data.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(env.data.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(env.data.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return configSchema.parse(JSON.parse(plain));
  } catch {
    // Gộp mọi lỗi giải mã (sai mật khẩu, hỏng tag, payload lạ) thành một thông báo
    throw badRequest('Mật khẩu sai hoặc file sao lưu không hợp lệ');
  }
}

/** Thay thế toàn bộ cấu hình AI hiện tại bằng bản sao lưu. */
export function restoreAiConfig(config: AiConfigBackup): { providers: number; enabled: boolean } {
  const db = getDb();
  const raw = getRawDb();
  raw.transaction(() => {
    db.delete(aiProviders).run();
    config.providers.forEach((p, i) => {
      createProviderRow({ ...p, sortOrder: p.sortOrder ?? (i + 1) * 10 });
    });
    setAiGlobalEnabled(config.enabled);
  })();
  return { providers: config.providers.length, enabled: config.enabled };
}
