import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { customerAliases, customers, productAliases, products, salesHistory } from '../db/schema.js';
import {
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

function tokenScore(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
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
        score: Math.max(
          tokenScore(simple, simplifyCompanyName(c.name)),
          tokenScore(norm, normalizeText(c.name)),
        ),
      }))
      .filter((s) => s.score >= 0.6)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 1 && scored[0]!.score >= 0.85) {
      return {
        status: 'matched',
        customerId: scored[0]!.c.id,
        customer: toCustomer(scored[0]!.c),
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

export function matchProduct(
  line: ParsedLine,
  customerId: number | null,
  customerTaxCode: string | null,
): ProductMatch {
  const db = getDb();
  const all = db.select().from(products).all();
  const modelNorm = normalizeCode(line.model.replace(/[\s.\-/]+/g, ''));

  // 1. model trùng code (bỏ khoảng trắng, hoa/thường)
  if (modelNorm) {
    const hit = all.find((p) => normalizeCode(p.code.replace(/[\s.\-/]+/g, '')) === modelNorm);
    if (hit) {
      return {
        status: 'matched',
        productId: hit.id,
        product: toProduct(hit),
        method: 'model_exact',
      };
    }
  }

  // 2. product_aliases theo model chuẩn hóa
  if (line.model) {
    const aliases = db.select().from(productAliases).all();
    const target = normalizeCode(line.model);
    const aliasHit = aliases.find((a) => normalizeCode(a.aliasText) === target);
    if (aliasHit) {
      const hit = all.find((p) => p.id === aliasHit.productId);
      if (hit) {
        return {
          status: 'matched',
          productId: hit.id,
          product: toProduct(hit),
          method: 'alias',
        };
      }
    }
  }

  // 3. model nằm trong tên/mã hoặc ngược lại + xếp hạng theo xuất xứ, lịch sử mua
  const modelA = normalizeCode(line.model);
  const nameNorm = normalizeText(line.name);
  const originNorm = normalizeText(line.origin);
  const scored: Scored[] = [];
  const history = customerTaxCode
    ? db
        .select()
        .from(salesHistory)
        .where(eq(salesHistory.customerTaxCode, customerTaxCode))
        .all()
    : [];

  for (const p of all) {
    const codeNorm = normalizeCode(p.code);
    let score = 0;
    let reason = '';
    if (modelA && (codeNorm.includes(modelA) || modelA.includes(codeNorm))) {
      score = Math.max(score, 0.75);
      reason = 'model nằm trong mã hàng';
    }
    const prodNameNorm = normalizeText(p.name);
    const nameOverlap = tokenScore(nameNorm, prodNameNorm);
    if (nameOverlap > score) {
      score = nameOverlap;
      reason = 'khớp tên hàng';
    }
    if (score >= 0.5) {
      // điểm cộng: xuất xứ nằm trong tên/mã sản phẩm
      if (originNorm && normalizeText(p.name).includes(originNorm)) {
        score = Math.min(0.99, score + 0.08);
        reason += '+ khớp xuất xứ';
      }
      if (history.some((h) => normalizeCode(h.productCode) === codeNorm)) {
        score = Math.min(0.99, score + 0.05);
        reason += '+ đã từng mua';
      }
      scored.push({ p, score: Math.round(score * 100) / 100, reason });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 1 && scored[0]!.score >= 0.9) {
    return {
      status: 'matched',
      productId: scored[0]!.p.id,
      product: toProduct(scored[0]!.p),
      method: 'model_contained',
    };
  }
  if (scored.length > 0) {
    return {
      status: 'candidate',
      productId: null,
      candidates: scored.slice(0, 5).map((s) => ({
        id: s.p.id,
        code: s.p.code,
        name: s.p.name,
        unit: s.p.unit,
        score: s.score,
        reason: s.reason,
      })),
    };
  }

  // 4-5. khớp gần đúng theo tên (token overlap cao) rồi fallback unmatched
  return { status: 'unmatched', productId: null };
}

function toProduct(p: typeof products.$inferSelect): NonNullable<ProductMatch['product']> {
  return { id: p.id, code: p.code, name: p.name, unit: p.unit };
}

export const __matchInternals = { and, parseTaxRate, tokenScore };
