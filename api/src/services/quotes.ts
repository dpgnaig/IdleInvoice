import crypto from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { getDb, getRawDb } from '../db/index.js';
import {
  invoices,
  invoiceLines,
  quoteFiles,
  quotes,
  customerAliases,
  productAliases,
  customers,
  products,
  salesHistory,
} from '../db/schema.js';
import type { ParsedQuote, ParsedLine } from './parser-client.js';
import { matchCustomer, matchProduct, type CustomerMatch, type ProductMatch } from './match.js';
import type { AiEnrichment, AiStatus } from './ai-enrich.js';
import { lookupTaxExternal } from './tax-lookup.js';
import { normalizeCode, normalizeTaxCode, normalizeText, parseTaxRate } from '../lib/normalize.js';

/** Kết quả ghép nối cho 1 báo giá. */
export interface DraftLine {
  parsed: ParsedLine;
  productMatch: ProductMatch;
  qty: number | null;
  unitPrice: number | null;
  amount: number | null;
  taxRate: number | 'KCT' | 'KKKNT';
}

export interface DraftQuote {
  fileHash: string;
  originalName: string;
  parsed: ParsedQuote;
  customerMatch: CustomerMatch;
  lines: DraftLine[];
  warnings: string[];
  /** Tổng kết bước AI (undefined khi AI tắt/không chạy). */
  ai?: AiStatus;
}

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Ghép tất định trước (MST/alias/tên, model/mã/tên hàng). Kết quả này luôn
 * được dùng làm nền; AI chỉ bổ sung gợi ý khi được bật.
 */
export function matchQuote(parsed: ParsedQuote): {
  customerMatch: CustomerMatch;
  lines: Array<{ productMatch: ProductMatch; qty: number | null; unitPrice: number | null; amount: number | null; taxRate: number | 'KCT' | 'KKKNT' }>;
  customerTax: string | null;
} {
  const customerMatch = matchCustomer(parsed.buyer_name, parsed.buyer_tax_code);
  const customerId = customerMatch.customerId;
  const customerTax = customerMatch.customer?.taxCode ?? normalizeTaxCode(parsed.buyer_tax_code) ?? null;
  const defaultTax = normalizeTax(parsed.tax_rate);
  const lines = parsed.lines.map((line) => ({
    productMatch: matchProduct(line, customerId, customerTax),
    qty: line.qty,
    unitPrice: line.unit_price,
    amount: line.amount,
    taxRate: defaultTax,
  }));
  return { customerMatch, lines, customerTax };
}

/**
 * Trộn kết quả AI vào draft. Nguyên tắc:
 *  - MST khách hàng: AI không được ghi đè MST đọc được từ file (chỉ dùng khi file trống).
 *  - Mã hàng: AI chỉ chọn trong danh sách ứng viên; nếu chọn đúng thì nâng bậc thành matched.
 *  - Tên/hãng/model/mô tả: giữ bản gốc khi AI không trả về tương ứng.
 */
function applyAi(draft: DraftQuote, ai: AiEnrichment): DraftQuote {
  const parsed: ParsedQuote = { ...draft.parsed, lines: [...draft.parsed.lines] };
  let customerMatch = draft.customerMatch;

  if (ai.customer) {
    const aiMatch = ai.customer.customerMatch;
    const keepTax = Boolean(normalizeTaxCode(parsed.buyer_tax_code));
    // Đã ghép chắc chắn từ trước thì giữ nguyên — AI chỉ được bổ sung gợi ý,
    // không được hạ xuống 'candidate' và bắt người dùng chọn lại.
    if (customerMatch.status !== 'matched') {
      customerMatch = aiMatch;
      if (!keepTax && ai.customer.info) {
        parsed.buyer_tax_code = ai.customer.info.taxCode;
        parsed.buyer_tax_code_confidence = 'medium';
        if (!parsed.buyer_name) {
          parsed.buyer_name = ai.customer.info.name;
          parsed.buyer_name_confidence = 'medium';
        }
      }
    } else if (aiMatch.status === 'candidate' && aiMatch.candidates?.length) {
      customerMatch = { ...customerMatch, candidates: aiMatch.candidates };
    }
  }

  const customerId = customerMatch.customerId;
  const customerTax = customerMatch.customer?.taxCode ?? normalizeTaxCode(parsed.buyer_tax_code) ?? null;

  const lines = draft.lines.map((dl, i) => {
    const s = ai.lines[i];
    const line: ParsedLine = { ...dl.parsed };
    let productMatch = dl.productMatch;
    if (s) {
      if (s.name) line.name = s.name;
      if (s.brand) line.brand = s.brand;
      if (s.model) line.model = s.model;
      if (s.desc) line.spec_text = s.desc;

      // AI chọn đúng một ứng viên (đã được giới hạn trong danh sách gửi lên)
      if (s.product) {
        productMatch = {
          status: 'matched',
          productId: s.product.id,
          product: s.product,
          method: 'ai',
        };
      } else if (s.productId != null) {
        const cand = (productMatch.candidates ?? []).find((c) => c.id === s.productId);
        if (cand) {
          productMatch = {
            status: 'matched',
            productId: cand.id,
            product: { id: cand.id, code: cand.code, name: cand.name, unit: cand.unit },
            method: 'ai',
          };
        }
      }

      // AI sửa tên/model -> ghép lại trên toàn bộ danh mục (không chỉ top-5 ban đầu)
      const changed = Boolean(s.name || s.model || s.brand || s.desc);
      if (!s.product && productMatch.status !== 'matched' && changed) {
        const rematch = matchProduct(line, customerId, customerTax);
        if (rematch.status !== 'unmatched' || rematch.candidates?.length) productMatch = rematch;
      }
    }
    parsed.lines[i] = line;
    return { ...dl, parsed: line, productMatch };
  });

  return {
    ...draft,
    parsed,
    customerMatch,
    lines,
    warnings: [
      ...draft.warnings,
      ...(ai.status.notes ?? []).map((n) => `AI: ${n}`),
    ],
  };
}

/** Xử lý trọn 1 file đã parse: ghép khách/hàng + cảnh báo. */
export function buildDraft(
  parsed: ParsedQuote,
  originalName: string,
  fileHash: string,
  ai?: AiEnrichment,
  precomputed?: ReturnType<typeof matchQuote>,
): DraftQuote {
  const base = precomputed ?? matchQuote(parsed);
  const customerId = base.customerMatch.customerId;
  const customerTax = base.customerTax;

  const lines: DraftLine[] = parsed.lines.map((line, i) => ({
    parsed: line,
    productMatch: base.lines[i]!.productMatch,
    qty: line.qty,
    unitPrice: line.unit_price,
    amount: line.amount,
    taxRate: base.lines[i]!.taxRate,
  }));

  const draft: DraftQuote = {
    fileHash,
    originalName,
    parsed,
    customerMatch: base.customerMatch,
    lines,
    warnings: [...parsed.warnings],
  };

  return finalizeDraft(ai ? { ...applyAi(draft, ai), ai: ai.status } : draft, customerTax);
}

export interface TaxLookupDraft {
  customerMatch: CustomerMatch;
  /** Thông tin đăng ký lấy từ VietQR — caller tự quyết định thêm vào DSKH. */
  info?: {
    taxCode: string;
    name: string;
    address: string;
    status?: string;
    source: string;
  };
  warning?: string;
}

/**
 * MST đọc được từ file mà chưa có trong danh mục -> tra VietQR để có tên/địa
 * chỉ chính thức. Độc lập với AI: chạy cả khi AI tắt.
 */
export async function lookupDraftCustomer(parsed: ParsedQuote): Promise<TaxLookupDraft | null> {
  if (process.env.TAX_LOOKUP_ENABLED === 'false') return null;
  const tax = normalizeTaxCode(parsed.buyer_tax_code ?? '');
  if (!tax || tax.length < 10) return null;

  const db = getDb();
  const local = db.select().from(customers).where(eq(customers.taxCode, tax)).get();
  if (local) {
    return {
      customerMatch: {
        status: 'matched',
        customerId: local.id,
        customer: {
          id: local.id,
          taxCode: local.taxCode,
          name: local.name,
          address: local.address,
          email: local.email,
          buyerName: local.buyerName,
          bankAccount: local.bankAccount,
          budgetUnitCode: local.budgetUnitCode,
        },
        method: 'tax_code',
      },
    };
  }

  const looked = await lookupTaxExternal(tax);
  if (looked.error) return { customerMatch: { status: 'new_customer', customerId: null }, warning: looked.error };
  if (!looked.info) return null;

  return {
    customerMatch: { status: 'new_customer', customerId: null, method: 'tax_lookup' },
    info: {
      taxCode: tax,
      name: looked.info.name,
      address: looked.info.address,
      status: looked.info.status,
      source: looked.info.source,
    },
    warning: `Tra cứu MST ${tax}: ${looked.info.name}`,
  };
}

/** Cảnh báo nghiệp vụ — chạy SAU khi đã trộn AI để phản ánh dữ liệu cuối. */
function finalizeDraft(draft: DraftQuote, customerTaxIn: string | null): DraftQuote {
  const { parsed, lines, customerMatch } = draft;
  const warnings: string[] = [...draft.warnings];
  const customerTax = customerMatch.customer?.taxCode ?? customerTaxIn;
  const db = getDb();

  // Số báo giá đã tồn tại?
  if (parsed.quote_no) {
    const existing = db.select().from(quotes).where(eq(quotes.quoteNo, parsed.quote_no)).get();
    if (existing) warnings.push(`Số báo giá "${parsed.quote_no}" đã tồn tại trong hệ thống`);
  }

  // Báo giá quá hạn hiệu lực
  if (parsed.quote_date && parsed.validity_days != null) {
    const issued = new Date(parsed.quote_date).getTime();
    if (!Number.isNaN(issued)) {
      const expiry = issued + parsed.validity_days * 86_400_000;
      if (Date.now() > expiry) warnings.push('Báo giá đã quá hạn hiệu lực');
    }
  }

  // Nguy cơ xuất trùng + lệch đơn giá so với lịch sử
  if (customerTax) {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    for (const l of lines) {
      if (!l.productMatch.product) continue;
      const code = l.productMatch.product.code;
      const recent = getRawDb()
        .prepare(
          `SELECT product_name, unit_price FROM sales_history
           WHERE customer_tax_code = ? AND product_code = ? AND (invoice_date IS NULL OR invoice_date >= ?)
           ORDER BY invoice_date DESC, id DESC`,
        )
        .all(customerTax, code, since) as Array<{ product_name: string; unit_price: number }>;
      if (!recent.length) continue;
      const r = recent[0]!;
      if (l.qty === recentQtyOf(customerTax, code, since) && l.unitPrice === r.unit_price) {
        warnings.push(
          `Dòng "${l.parsed.name.slice(0, 30)}": khách này đã mua cùng mã ${code}, cùng SL và đơn giá trong 30 ngày — kiểm tra xuất trùng`,
        );
      } else if (l.unitPrice != null && Math.abs(l.unitPrice - r.unit_price) / Math.max(1, r.unit_price) > 0.1) {
        warnings.push(
          `Đơn giá "${l.parsed.name.slice(0, 30)}" (${l.unitPrice?.toLocaleString()}) lệch lớn so với giá gần nhất (${r.unit_price.toLocaleString()}) cho khách này`,
        );
      }
    }
  }

  return { ...draft, warnings };
}

function normalizeTax(t: number | null): number | 'KCT' | 'KKKNT' {
  const v = parseTaxRate(t);
  if (v === null) return 0.08;
  return v;
}

/** Khối lượng đã mua gần đây của 1 khách+mã hàng. */
function recentQtyOf(customerTax: string, productCode: string, since: string): number | null {
  const rows = getRawDb()
    .prepare(
      `SELECT DISTINCT qty FROM sales_history
       WHERE customer_tax_code = ? AND product_code = ? AND (invoice_date IS NULL OR invoice_date >= ?)
       LIMIT 5`,
    )
    .all(customerTax, productCode, since) as Array<{ qty: number }>;
  return rows.length === 1 ? rows[0]!.qty : null;
}

/* ============ CONFIRM: lưu quotes + invoices draft ============ */

export interface ConfirmLine {
  productId: number;
  qty: number;
  unitPrice: number;
  taxRate: number | 'KCT' | 'KKKNT' | string;
  rememberAlias?: boolean;
  /** Model/mã đọc từ báo giá của chính dòng này, dùng làm alias khi ghi nhớ. */
  aliasText?: string;
}

export interface ConfirmPayload {
  quoteNo: string;
  quoteDate: string | null;
  customerId: number;
  fileHash: string;
  declaredSubtotal: number | null;
  declaredVat: number | null;
  declaredTotal: number | null;
  validityDays: number | null;
  note?: string;
  lines: ConfirmLine[];
  rememberCustomerAlias?: boolean;
  aliasText?: string;
  parsedBuyerName?: string;
}

export function taxToDb(t: number | 'KCT' | 'KKKNT' | string): number | 0 {
  if (t === 'KCT' || t === 'KKKNT') return 0;
  const n = typeof t === 'string' ? Number(t) : t;
  return Number.isFinite(n) ? n : 0.08;
}

export function confirmDraft(payload: ConfirmPayload, createdBy: number, parsed: ParsedQuote | null) {
  const db = getDb();
  const raw = getRawDb();
  const now = new Date().toISOString();

  const customer = db.select().from(customers).where(eq(customers.id, payload.customerId)).get();
  if (!customer) throw new Error('Không tìm thấy khách hàng');

  for (const l of payload.lines) {
    const p = db.select().from(products).where(eq(products.id, l.productId)).get();
    if (!p) throw new Error(`Không tìm thấy hàng hóa id=${l.productId}`);
  }

  return raw.transaction(() => {
    const qf = db.select().from(quoteFiles).where(eq(quoteFiles.fileHash, payload.fileHash)).get();
    const quote = db
      .insert(quotes)
      .values({
        quoteNo: payload.quoteNo,
        quoteDate: payload.quoteDate,
        customerId: payload.customerId,
        quoteFileId: qf?.id ?? null,
        declaredSubtotal: payload.declaredSubtotal,
        declaredVat: payload.declaredVat,
        declaredTotal: payload.declaredTotal,
        validityDays: payload.validityDays,
        note: payload.note ?? '',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    const invoice = db
      .insert(invoices)
      .values({
        quoteId: quote.id,
        customerId: payload.customerId,
        paymentMethod: parsed?.payment_terms || 'Chuyển khoản',
        status: 'draft',
        createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    payload.lines.forEach((l, i) => {
      db.insert(invoiceLines)
        .values({
          invoiceId: invoice.id,
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          taxRate: typeof taxToDb(l.taxRate) === 'number' ? (taxToDb(l.taxRate) as number) : 0,
          taxRateCode: typeof l.taxRate === 'string' ? l.taxRate : null,
          sortOrder: i,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      if (l.rememberAlias) {
        const alias = normalizeCode(l.aliasText ?? '');
        if (alias) {
          raw.prepare('INSERT OR IGNORE INTO product_aliases (created_at, updated_at, alias_text, product_id) VALUES (?, ?, ?, ?)')
            .run(now, now, alias, l.productId);
        }
      }
    });

    if (payload.rememberCustomerAlias && payload.aliasText) {
      const key = normalizeText(payload.aliasText);
      if (key) {
        raw.prepare('INSERT OR IGNORE INTO customer_aliases (created_at, updated_at, alias_text, customer_id) VALUES (?, ?, ?, ?)')
          .run(now, now, payload.aliasText.trim(), payload.customerId);
      }
    }

    return { quote, invoice };
  })();
}

export function duplicateCheck(invoiceId: number): string[] {
  const db = getDb();
  const warn: string[] = [];
  const inv = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  if (!inv) return ['Không tìm thấy hóa đơn'];
  const cust = db.select().from(customers).where(eq(customers.id, inv.customerId)).get();
  const linesDb = db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).all();
  if (!cust) return warn;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  for (const l of linesDb) {
    const p = db.select().from(products).where(eq(products.id, l.productId)).get();
    if (!p) continue;
    const rows = getRawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM sales_history
         WHERE customer_tax_code = ? AND product_code = ? AND qty = ? AND unit_price = ? AND (invoice_date IS NULL OR invoice_date >= ?)`,
      )
      .get(cust.taxCode, p.code, l.qty, l.unitPrice, since) as { n: number };
    if (rows.n > 0) {
      warn.push(`Dòng "${p.name.slice(0, 30)}" đã xuất cho khách này với cùng SL và đơn giá trong 30 ngày`);
    }
  }
  return warn;
}

export function lastPrice(customerTaxCode: string, productCode: string) {
  const row = getRawDb()
    .prepare(
      `SELECT unit_price, invoice_date, invoice_no FROM sales_history
       WHERE customer_tax_code = ? AND product_code = ?
       ORDER BY invoice_date DESC, id DESC LIMIT 1`,
    )
    .get(customerTaxCode, productCode) as { unit_price: number; invoice_date: string; invoice_no: string } | undefined;
  return row ?? null;
}

export const __quoteHelpers = { count };
