/**
 * Mã hóa API key của nhà cung cấp AI trước khi lưu vào SQLite (cột `api_key`
 * trước đây lưu plaintext). Khóa chủ rút ra từ JWT_ACCESS_SECRET đã có sẵn
 * (bắt buộc >= 32 ký tự) qua scrypt — không cần thêm biến môi trường mới.
 */
import crypto from 'node:crypto';
import { getEnv } from '../env.js';

const KEY_SALT = 'idleinvoice.ai-provider-api-key.v1';
const ENC_PREFIX = 'enc:v1:';

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (!cachedKey) {
    cachedKey = crypto.scryptSync(getEnv().JWT_ACCESS_SECRET, KEY_SALT, 32);
  }
  return cachedKey;
}

export function isEncryptedApiKey(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX);
}

/** Chuỗi rỗng giữ nguyên (không có gì để mã hóa). */
export function encryptApiKey(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

/**
 * Dữ liệu cũ (trước khi thêm mã hóa) không có tiền tố `enc:v1:` — coi là
 * plaintext để tương thích ngược; `ai-providers.ts` tự nâng cấp khi đọc thấy.
 */
export function decryptApiKey(stored: string): string {
  if (!stored || !isEncryptedApiKey(stored)) return stored;
  try {
    const [ivB64, tagB64, dataB64] = stored.slice(ENC_PREFIX.length).split(':');
    if (!ivB64 || !tagB64 || !dataB64) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

/** Dùng cho test: xóa cache khóa chủ (vd sau khi đổi JWT_ACCESS_SECRET). */
export const __aiKeyCryptoInternals = {
  resetCache: () => {
    cachedKey = null;
  },
};
