import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { customerAliases, customers, productAliases, products, salesHistory } from '../db/schema.js';
import {
  codeKey,
  normalizeCode,
  normalizeTaxCode,
  normalizeText,
  parseTaxRate,
  simplifyCompanyName,
} from '../lib/normalize.js';
import type { ParsedLine, ParsedQuote } from './parser-client.js';

/* ============ GHÉP KHÁCH HÀNG ============ */

export interface CustomerMatch {
  status: 'matched' | 'candidate' | 'new_customer';
  customerId: number | null;
  customer?: {
    id: number;
    taxCode: string;
    name: string;
    address: string;
    email: string;
    buyerName: string;
    bankAccount: string;
    budgetUnitCode: string;
  } | null;
  method?: string;
  candidates?: Array<{ id: number; taxCode: string; name: string; score: number }>;
}

/**
 * Tên đã đủ chắc để tự chọn khách hàng (điền luôn MST) thay vì bắt người dùng
 * chọn trong danh sách gợi ý:
 *  - điểm ≥ 0.85, hoặc
 *  - điểm ≥ 0.70 và bỏ xa ứng viên kế tiếp (≥ 0.15).
 * `scored` phải đã sắp giảm dần theo điểm.
 */
export function confidentCustomer(scored: Array<{ score: number }>): boolean {
  const top = scored[0];
  if (!top) return false;
  const second = scored[1];
  return top.score >= 0.85 || (top.score >= 0.7 && (!second || top.score - second.score >= 0.15));
}

/**
 * Dice trên tập token: 2·|A∩B| / (|A|+|B|).
 * Công bằng hơn Jaccard/chia max khi một bên có thêm từ mô tả
 * (vd tên đầy đủ trong DSKH dài hơn tên trên báo giá).
 */
export function tokenScore(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

export function matchCustomer(buyerName: string, buyerTaxCode: string): CustomerMatch {
  const db = getDb();
  const all = db.select().from(customers).all();

  // 1. MST trùng
  const tax = normalizeTaxCode(buyerTaxCode);
  if (tax) {
    const hit = all.find((c) => normalizeTaxCode(c.taxCode) === tax);
    if (hit) {
      return {
        status: 'matched',
        customerId: hit.id,
        customer: toCustomer(hit),
        method: 'tax_code',
      };
    }
  }

  // 2. alias_text theo tên chuẩn hóa
  const norm = normalizeText(buyerName);
  if (norm) {
    const aliases = db.select().from(customerAliases).all();
    const aliasHit = aliases.find((a) => normalizeText(a.aliasText) === norm);
    if (aliasHit) {
      const hit = all.find((c) => c.id === aliasHit.customerId);
      if (hit) {
        return {
          status: 'matched',
          customerId: hit.id,
          customer: toCustomer(hit),
          method: 'alias',
        };
      }
    }
  }

  // 3. Khớp gần đúng theo tên rút gọn
  const simple = simplifyCompanyName(buyerName);
  if (simple) {
    const scored = all
      .map((c) => ({
        c,
        score: tokenScore(simple, simplifyCompanyName(c.name)),
      }))
      .filter((s) => s.score >= 0.6)
      .sort((a, b) => b.score - a.score);
    // Chỉ có tên trong báo giá -> tự chọn khi đủ chắc để điền luôn MST
    if (confidentCustomer(scored)) {
      const hit = scored[0]!.c;
      return {
        status: 'matched',
        customerId: hit.id,
        customer: toCustomer(hit),
        method: 'fuzzy_unique',
      };
    }
    if (scored.length > 0) {
      return {
        status: 'candidate',
        customerId: null,
        candidates: scored.slice(0, 5).map((s) => ({
          id: s.c.id,
          taxCode: s.c.taxCode,
          name: s.c.name,
          score: Math.round(s.score * 100) / 100,
        })),
      };
    }
  }

  // 4. Khách mới
  return { status: 'new_customer', customerId: null };
}

function toCustomer(c: typeof customers.$inferSelect): NonNullable<CustomerMatch['customer']> {
  return {
    id: c.id,
    taxCode: c.taxCode,
    name: c.name,
    address: c.address,
    email: c.email,
    buyerName: c.buyerName,
    bankAccount: c.bankAccount,
    budgetUnitCode: c.budgetUnitCode,
  };
}

/* ============ GHÉP HÀNG HÓA ============ */

export interface ProductMatch {
  status: 'matched' | 'candidate' | 'unmatched';
  productId: number | null;
  product?: { id: number; code: string; name: string; unit: string } | null;
  method?: string;
  candidates?: Array<{
    id: number;
    code: string;
    name: string;
    unit: string;
    score: number;
    reason: string;
  }>;
}

interface Scored {
  p: typeof products.$inferSelect;
  score: number;
  reason: string;
}

/**
 * Ghép dòng báo giá với mã hàng trong danh mục.
 *
 * Thứ tự ưu tiên (theo nghiệp vụ: "model là khoá chính"):
 *   1. model trùng khít mã hàng      — "HD-270" -> "HD-270"
 *   2. model đã ghi nhớ (alias)
 *   3. mã hàng bắt đầu bằng model    — "LT - 040" -> "LT-040-0.75kw", "LT-040-1.5kw", …
 *   4. mã hàng chứa model            — "PK.VANXA.LT040", "THANLT-040"
 *   5. tên hàng trùng khớp           — chỉ khi model không tìm được gì
 *
 * So khớp bỏ toàn bộ dấu (`codeKey`) nên "LT - 040", "LT-040", "lt040" là một.
 * Tầng 3/4 trả về `candidate` khi có nhiều mã cùng khớp để người dùng chọn,
 * thay vì đoán bừa một mã.
 */
export function matchProduct(
  line: ParsedLine,
  customerId: number | null,
  customerTaxCode: string | null,
): ProductMatch {
  const db = getDb();
  const all = db.select().from(products).all();

  const byKey = new Map<string, typeof products.$inferSelect>();
  for (const p of all) byKey.set(codeKey(p.code), p);

  const modelKey = codeKey(line.model);

  // 1. model trùng khít mã hàng (bỏ hết dấu, hoa/thường)
  if (modelKey) {
    const hit = byKey.get(modelKey);
    if (hit) {
      return { status: 'matched', productId: hit.id, product: toProduct(hit), method: 'model_exact' };
    }
  }

  // 2. product_aliases theo model
  if (line.model) {
    const aliases = db.select().from(productAliases).all();
    const target = normalizeCode(line.model);
    const aliasHit = aliases.find((a) => normalizeCode(a.aliasText) === target);
    if (aliasHit) {
      const hit = all.find((p) => p.id === aliasHit.productId);
      if (hit) {
        return { status: 'matched', productId: hit.id, product: toProduct(hit), method: 'alias' };
      }
    }
  }

  const history = customerTaxCode
    ? db.select().from(salesHistory).where(eq(salesHistory.customerTaxCode, customerTaxCode)).all()
    : [];
  const boughtBefore = (code: string) =>
    history.some((h) => codeKey(h.productCode) === codeKey(code));

  /** Ưu tiên mã đã từng mua, rồi tới mã ngắn hơn (thường là mã gốc). */
  const rankTier = (list: Array<typeof products.$inferSelect>) =>
    [...list].sort((a, b) => {
      const ha = boughtBefore(a.code) ? 1 : 0;
      const hb = boughtBefore(b.code) ? 1 : 0;
      if (ha !== hb) return hb - ha;
      return codeKey(a.code).length - codeKey(b.code).length;
    });

  const tierResult = (
    list: Array<typeof products.$inferSelect>,
    reason: string,
    method: string,
  ): ProductMatch | null => {
    if (list.length === 0) return null;
    const ranked = rankTier(list);
    if (ranked.length === 1) {
      return { status: 'matched', productId: ranked[0]!.id, product: toProduct(ranked[0]!), method };
    }
    return {
      status: 'candidate',
      productId: null,
      candidates: ranked.slice(0, 5).map((p, i) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        unit: p.unit,
        score: Math.max(0.6, 0.9 - i * 0.05),
        reason,
      })),
    };
  };

  // 3. mã hàng bắt đầu bằng model: "LT - 040" -> LT-040-*
  if (modelKey.length >= 3) {
    const prefixed = all.filter((p) => {
      const k = codeKey(p.code);
      return k !== modelKey && k.startsWith(modelKey);
    });
    const r = tierResult(prefixed, 'mã hàng bắt đầu bằng model', 'model_prefix');
    if (r) return r;
  }

  // 4. mã hàng chứa model (hoặc model chứa mã hàng): "HD-270" -> HD270KHAU
  if (modelKey.length >= 3) {
    const contained = all.filter((p) => {
      const k = codeKey(p.code);
      if (k === modelKey) return false;
      return k.includes(modelKey) || (modelKey.includes(k) && k.length >= 3);
    });
    const r = tierResult(contained, 'mã hàng chứa model', 'model_contained');
    if (r) return r;
  }

  // 5. Không khớp model -> xếp hạng theo tên hàng
  const nameNorm = normalizeText(line.name);
  const originNorm = normalizeText(line.origin);
  if (nameNorm) {
    const scored: Scored[] = [];
    for (const p of all) {
      let score = tokenScore(nameNorm, normalizeText(p.name));
      if (score < 0.5) continue;
      let reason = 'khớp tên hàng';
      if (originNorm && normalizeText(p.name).includes(originNorm)) {
        score = Math.min(0.99, score + 0.08);
        reason += '+ khớp xuất xứ';
      }
      if (boughtBefore(p.code)) {
        score = Math.min(0.99, score + 0.05);
        reason += '+ đã từng mua';
      }
      scored.push({ p, score: Math.round(score * 100) / 100, reason });
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length === 1 && scored[0]!.score >= 0.9) {
      return { status: 'matched', productId: scored[0]!.p.id, product: toProduct(scored[0]!.p), method: 'name' };
    }
    if (scored.length > 0) {
      return {
        status: 'candidate',
        productId: null,
        candidates: scored.slice(0, 5).map((s2) => ({
          id: s2.p.id,
          code: s2.p.code,
          name: s2.p.name,
          unit: s2.p.unit,
          score: s2.score,
          reason: s2.reason,
        })),
      };
    }
  }

  return { status: 'unmatched', productId: null };
}

function toProduct(p: typeof products.$inferSelect): NonNullable<ProductMatch['product']> {
  return { id: p.id, code: p.code, name: p.name, unit: p.unit };
}

/**
 * Ứng viên rộng cho AI (mặc định 20), gộp khớp mã + khớp tên trên TOÀN BỘ danh mục.
 * `matchProduct` cắt 5 để hiển thị UI; AI cần nhiều hơn thì mới cứu được các
 * dòng mà bộ ghép tất định không chọn được.
 */
export function candidatesForAi(
  line: ParsedLine,
  limit = 20,
): Array<{ id: number; code: string; name: string; unit: string }> {
  const db = getDb();
  const all = db.select().from(products).all();
  const out: Array<typeof products.$inferSelect> = [];
  const seen = new Set<number>();
  const push = (p: typeof products.$inferSelect) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push(p);
  };
  const pushMany = (list: Array<typeof products.$inferSelect>) => {
    for (const p of list) {
      if (out.length >= limit) return;
      push(p);
    }
  };

  const modelKey = codeKey(line.model);
  if (modelKey) {
    // Thứ tự ưu tiên giống matchProduct: khít -> alias -> bắt đầu bằng -> chứa
    pushMany(all.filter((p) => codeKey(p.code) === modelKey));

    const target = normalizeCode(line.model);
    const alias = db.select().from(productAliases).all().find((a) => normalizeCode(a.aliasText) === target);
    const aliasProduct = alias ? all.find((p) => p.id === alias.productId) : undefined;
    if (aliasProduct) push(aliasProduct);

    if (modelKey.length >= 3) {
      pushMany(all.filter((p) => {
        const k = codeKey(p.code);
        return k !== modelKey && k.startsWith(modelKey);
      }));
      pushMany(all.filter((p) => {
        const k = codeKey(p.code);
        if (k === modelKey) return false;
        return k.includes(modelKey) || (modelKey.includes(k) && k.length >= 3);
      }));
    }
  }

  const nameNorm = normalizeText(line.name);
  if (nameNorm) {
    const scored = all
      .map((p) => ({ p, score: tokenScore(nameNorm, normalizeText(p.name)) }))
      .filter((s) => s.score >= 0.3)
      .sort((a, b) => b.score - a.score);
    pushMany(scored.map((s) => s.p));
  }

  return out.slice(0, limit).map(toProduct);
}

export const __matchInternals = { and, parseTaxRate, tokenScore };
