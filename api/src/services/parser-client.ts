import { getEnv } from '../env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export interface ParsedLine {
  line_no: number;
  name: string;
  unit: string;
  qty: number | null;
  unit_price: number | null;
  amount: number | null;
  model: string;
  brand: string;
  origin: string;
  spec_text: string;
  item_no?: string;
  /** Thuế suất riêng của dòng (0.08); null/undefined = dùng thuế suất chung. */
  tax_rate?: number | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface ParsedQuote {
  buyer_name: string;
  buyer_name_confidence: 'high' | 'medium' | 'low';
  buyer_tax_code: string;
  buyer_tax_code_confidence: 'high' | 'medium' | 'low';
  quote_no: string;
  quote_no_confidence: 'high' | 'medium' | 'low';
  quote_date: string;
  quote_date_confidence: 'high' | 'medium' | 'low';
  sender_name: string;
  receiver_name: string;
  lines: ParsedLine[];
  declared_subtotal: number | null;
  declared_vat: number | null;
  declared_total: number | null;
  tax_rate: number | null;
  payment_terms: string;
  validity_days: number | null;
  warnings: string[];
}

export interface ParserFailure {
  ok: false;
  status: number;
  error: string;
  errorCode: string;
  message: string;
}

export interface ParserSuccess {
  ok: true;
  data: ParsedQuote;
}

/**
 * Gọi Python parser service. Không bao giờ throw: trả kết quả lỗi có cấu trúc để
 * API trả thông báo thân thiện khi parser tắt.
 */
export async function parseWithPython(
  buffer: Buffer,
  filename: string,
  mime = 'application/octet-stream',
): Promise<ParserSuccess | ParserFailure> {
  const env = getEnv();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${env.PARSER_URL}/parse`, {
      method: 'POST',
      body: form,
      headers: { 'X-Internal-Key': env.INTERNAL_KEY },
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: String(body?.error ?? 'Không đọc được file'),
        errorCode: String(body?.error_code ?? 'PARSE_FAILED'),
        message: String(body?.message ?? body?.error ?? 'Không đọc được file'),
      };
    }
    return { ok: true, data: body as unknown as ParsedQuote };
  } catch (err) {
    logger.warn({ err, filename }, 'Parser service không phản hồi');
    return {
      ok: false,
      status: 503,
      error: 'Dịch vụ đọc báo giá tạm thời không khả dụng',
      errorCode: 'PARSER_UNAVAILABLE',
      message:
        'Không kết nối được dịch vụ đọc báo giá. Vui lòng kiểm tra service parser rồi thử lại.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function assertParserOk(
  r: ParserSuccess | ParserFailure,
): asserts r is ParserSuccess {
  if (!r.ok) {
    throw new AppError(502, r.message, { errorCode: r.errorCode }, r.errorCode);
  }
}

export interface PreviewSheet {
  name: string;
  rows: string[][];
}

export interface PreviewDoc {
  kind: 'excel' | 'word' | 'pdf' | string;
  sheets: PreviewSheet[];
  paragraphs: string[];
}

/** Dữ liệu thô của file Excel/Word để UI hiển thị như trình xem PDF. */
export async function previewWithPython(
  buffer: Buffer,
  filename: string,
  mime = 'application/octet-stream',
): Promise<PreviewDoc | null> {
  const env = getEnv();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${env.PARSER_URL}/preview`, {
      method: 'POST',
      body: form,
      headers: { 'X-Internal-Key': env.INTERNAL_KEY },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as PreviewDoc;
  } catch (err) {
    logger.warn({ err, filename }, 'Parser không trả dữ liệu xem trước');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Chuyển .xls -> .xlsx và .doc -> .docx (parser) để trình xem trên trình duyệt render được. */
export async function convertWithPython(
  buffer: Buffer,
  filename: string,
  mime = 'application/octet-stream',
): Promise<Buffer | null> {
  const env = getEnv();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${env.PARSER_URL}/convert`, {
      method: 'POST',
      body: form,
      headers: { 'X-Internal-Key': env.INTERNAL_KEY },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logger.warn({ err, filename }, 'Parser không chuyển được file để xem trước');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------- Tìm tương tự bằng rapidfuzz (parser service) ---------- */

export interface FuzzyCustomerCandidate {
  id: number;
  name: string;
  taxCode: string;
  score: number;
}

export interface FuzzyProductCandidate {
  id: number;
  code: string;
  name: string;
  unit: string;
  score: number;
  codeScore: number;
  textScore: number;
}

async function postMatch<T>(path: string, payload: unknown, timeoutMs = 20_000): Promise<T | null> {
  const env = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.PARSER_URL}${path}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': env.INTERNAL_KEY },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    logger.warn({ err, path }, 'Không gọi được tìm tương tự (rapidfuzz)');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Xếp hạng tên công ty gần giống trong danh mục. null khi parser tắt/lỗi. */
export async function fuzzyMatchCustomers(
  query: string,
  customers: Array<{ id: number; name: string; taxCode: string }>,
  limit = 20,
): Promise<FuzzyCustomerCandidate[] | null> {
  if (!query.trim() || !customers.length) return [];
  const res = await postMatch<{ candidates: FuzzyCustomerCandidate[] }>('/match/customers', {
    query,
    customers,
    limit,
  });
  return res?.candidates ?? null;
}

/** Xếp hạng mã hàng cho từng dòng, kết hợp mã + mô tả. null khi parser tắt/lỗi. */
export async function fuzzyMatchProducts(
  lines: Array<{ name: string; model: string; spec: string; brand: string }>,
  products: Array<{ id: number; code: string; name: string; unit: string }>,
  limit = 20,
): Promise<FuzzyProductCandidate[][] | null> {
  if (!lines.length || !products.length) return lines.map(() => []);
  const res = await postMatch<{ lines: FuzzyProductCandidate[][] }>('/match/products', {
    lines,
    products,
    limit,
  });
  return res?.lines ?? null;
}
