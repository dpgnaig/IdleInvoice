/**
 * Bước tìm tương tự (rapidfuzz) chạy TRƯỚC và độc lập với AI:
 *  - Khách hàng: xếp hạng tên công ty, khớp chắc thì gắn luôn (không cần AI).
 *  - Hàng hóa: ghép mã + mô tả kỹ thuật; khớp chắc thì gắn, còn lại đưa AI
 *    danh sách ứng viên đã xếp hạng để chọn.
 *
 * Không bao giờ throw: parser tắt/lỗi thì trả `undefined`, phần ghép tất định
 * và AI vẫn chạy như cũ.
 */
import { getDb } from '../db/index.js';
import { customers, products } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { normalizeTaxCode } from '../lib/normalize.js';
import { fuzzyMatchCustomers, fuzzyMatchProducts, type FuzzyProductCandidate } from './parser-client.js';
import type { ParsedQuote } from './parser-client.js';
import type { CustomerMatch, ProductMatch } from './match.js';
import type { CustomerEnrichment, LineSuggestion } from './ai-enrich.js';

export interface FuzzyProductCand {
  id: number;
  code: string;
  name: string;
  unit: string;
}

export interface FuzzyResult {
  customer?: CustomerEnrichment;
  /** Gợi ý đã khớp chắc, áp vào draft như kết quả AI. */
  lines: Record<number, LineSuggestion>;
  /** Ứng viên rapidfuzz theo chỉ số dòng (đưa cho AI và UI). */
  candidates: Record<number, FuzzyProductCand[]>;
  /** Shortlist khách hàng đã xếp hạng để nhét vào prompt AI. */
  customerShortlist: Array<{ name: string; taxCode: string; score: number }>;
  resolvedLines: number;
  resolvedCustomer: boolean;
}

/** Ngưỡng "khớp chắc" — bảo thủ để không tự gắn sai. */
const CUSTOMER_CONFIDENT = 0.85;

/** Điểm mã tối thiểu để tự gắn hàng hóa có model (> 0.9 = loại biến thể chỉ khác dấu). */
const MODEL_CODE_CONFIDENT = 0.95;

/** Mã trùng khít dạng viết (codeScore = 1.0). */
const EXACT_CODE = 0.999;

function customerConfident(c: FuzzyProductCandidate | undefined): boolean {
  return false; // (không dùng) — giữ chỗ cho tương lai nếu cần
}

/**
 * Dòng hàng có khớp chắc không?
 *  - Mã trùng tuyệt đối (HD-270 = HD-270): tin luôn (điểm gộp = 1.0).
 *  - Nhiều ứng viên sát điểm (cùng mã gốc, khác biến thể công suất): mơ hồ
 *    -> nhường AI, trừ khi parser đã tách công suất (kW) ra để phân định
 *    (điểm gộp lúc đó đã được cộng/trừ thưởng rõ rệt, không còn sát điểm).
 *  - Có model trên báo giá: cần điểm gộp đủ cao (mã + mô tả/công suất).
 *  - Không có model: dựa vào mô tả (điểm gộp = 0.8 × textScore, cần textScore ≥ 0.9).
 */
function lineConfident(cands: FuzzyProductCandidate[], hasModel: boolean): boolean {
  const best = cands[0];
  if (!best) return false;
  const runner = cands[1];
  // Mã trùng khít dạng viết là tín hiệu mạnh nhất: chọn luôn, trừ khi có >1 mã trùng khít.
  if (hasModel && (best.codeScore ?? 0) >= EXACT_CODE && (runner?.codeScore ?? 0) < EXACT_CODE) return true;
  const tied = runner != null && best.score - runner.score < 0.05;
  if (tied) return false;
  if (hasModel) {
    // Mã phải trùng đúng dạng viết (1.0) hoặc là biến thể hậu tố cùng dạng (~0.97).
    // "HD-270" ~ "HD270" (chỉ khác ký tự đặc biệt, <= 0.9) chỉ là gợi ý để người dùng chọn.
    if ((best.codeScore ?? 0) < MODEL_CODE_CONFIDENT) return false;
    return best.score >= 0.85;
  }
  return best.score >= 0.72;
}

export async function fuzzyEnrich(
  pq: ParsedQuote,
  lineMatches: ProductMatch[],
): Promise<FuzzyResult | undefined> {
  const db = getDb();
  const allCustomers = db.select().from(customers).all();
  const allProducts = db.select().from(products).all();
  if (!allCustomers.length && !allProducts.length) return undefined;

  const name = (pq.buyer_name ?? '').trim();
  // Có MST hợp lệ thì chỉ tra theo MST (bước tra cứu sau đảm nhận) — không đoán tên.
  const fileTax = normalizeTaxCode(pq.buyer_tax_code ?? '');
  const hasFileTax = fileTax.length >= 10;
  const [custRes, prodRes] = await Promise.all([
    name && !hasFileTax
      ? fuzzyMatchCustomers(
          name,
          allCustomers.map((c) => ({ id: c.id, name: c.name, taxCode: c.taxCode })),
          20,
        )
      : Promise.resolve([]),
    allProducts.length && pq.lines.length
      ? fuzzyMatchProducts(
          pq.lines.map((l) => ({ name: l.name, model: l.model, spec: l.spec_text, brand: l.brand })),
          allProducts.map((p) => ({ id: p.id, code: p.code, name: p.name, unit: p.unit })),
          20,
        )
      : Promise.resolve([]),
  ]);

  if (custRes == null && prodRes == null) {
    logger.debug('Tìm tương tự (rapidfuzz) không khả dụng');
    return undefined;
  }

  const result: FuzzyResult = {
    lines: {},
    candidates: {},
    customerShortlist: (custRes ?? []).map((c) => ({ name: c.name, taxCode: c.taxCode, score: c.score })),
    resolvedLines: 0,
    resolvedCustomer: false,
  };

  // Khách hàng: khớp chắc thì gắn luôn
  const topCustomer = custRes?.[0];
  if (topCustomer && topCustomer.score >= CUSTOMER_CONFIDENT) {
    const row = allCustomers.find((c) => c.id === topCustomer.id);
    if (row) {
      result.customer = {
        customerMatch: {
          status: 'matched',
          customerId: row.id,
          customer: {
            id: row.id,
            taxCode: row.taxCode,
            name: row.name,
            address: row.address,
            email: row.email,
            buyerName: row.buyerName,
            bankAccount: row.bankAccount,
            budgetUnitCode: row.budgetUnitCode,
          },
          method: 'fuzzy',
        },
      };
      result.resolvedCustomer = true;
    }
  }

  // Hàng hóa: mỗi dòng lấy ứng viên rapidfuzz; khớp chắc thì gắn
  (prodRes ?? []).forEach((cands, i) => {
    if (!cands.length) return;
    result.candidates[i] = cands.slice(0, 20).map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      unit: c.unit,
    }));
    const existing = lineMatches[i];
    const alreadyMatched = existing?.status === 'matched';
    if (alreadyMatched) return; // tất định đã chắc, không cần ghi đè
    const best = cands[0]!;
    const hasModel = Boolean(pq.lines[i]?.model);
    if (lineConfident(cands, hasModel)) {
      result.lines[i] = {
        productId: best.id,
        product: { id: best.id, code: best.code, name: best.name, unit: best.unit },
      };
      result.resolvedLines += 1;
    } else if (existing) {
      // Không đủ chắc để tự gắn: đưa ứng viên điểm rapidfuzz cao nhất lên đầu danh sách
      // người dùng/AI chọn (sửa tại chỗ vì buildDraft dùng chính các đối tượng này).
      const top = cands.slice(0, 5).map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        unit: c.unit,
        score: c.score,
        reason: `Tương tự ${Math.round(c.score * 100)}%`,
      }));
      const topIds = new Set(top.map((c) => c.id));
      const rest = (existing.candidates ?? []).filter((c) => !topIds.has(c.id));
      existing.candidates = [...top, ...rest].slice(0, 8);
    }
  });

  return result;
}

/** Dùng cho test nếu cần tách ngưỡng. */
export const __fuzzyInternals = { CUSTOMER_CONFIDENT, lineConfident };
