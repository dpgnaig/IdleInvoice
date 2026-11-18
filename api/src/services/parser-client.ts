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
