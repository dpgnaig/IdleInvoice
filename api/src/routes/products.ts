import { Router } from 'express';
import { and, asc, count, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { invoiceLines, productAliases, products } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { codeKey, normalizeCode } from '../lib/normalize.js';
import { asyncHandler } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';

export const productsRouter: Router = Router();

const productBody = z.object({
  code: z.string().trim().min(1, 'Vui lòng nhập mã hàng hóa'),
  name: z.string().trim().min(1, 'Vui lòng nhập tên hàng hóa'),
  unit: z.string().trim().min(1, 'Vui lòng nhập đơn vị tính'),
});

const listQuery = z.object({
  search: z.string().trim().optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  sort: z.string().optional().default('name'),
});

/**
 * Điều kiện tìm hàng hóa.
 * Ngoài LIKE thông thường trên mã/tên, so khớp thêm trên `code_key` (bỏ hết dấu)
 * để "LT 040", "lt-040" hay "LT - 040" đều tìm ra "LT-040-0.75kw".
 */
function productSearchCondition(search: string) {
  const term = `%${search}%`;
  const key = codeKey(search);
  const parts = [like(products.code, term), like(products.name, term)];
  if (key) parts.push(sql`code_key(${products.code}) LIKE ${`%${key}%`}`);
  return or(...parts);
}

productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const db = getDb();
    const where = q.search ? productSearchCondition(q.search) : undefined;
    const sortField = q.sort.startsWith('-') ? q.sort.slice(1) : q.sort;
    const sortColumn =
      sortField === 'code'
        ? products.code
        : sortField === 'createdAt'
          ? products.createdAt
          : products.name;
    const sortDir = q.sort.startsWith('-') ? desc : asc;
    const rows = db
      .select()
      .from(products)
      .where(where)
      .orderBy(sortDir(sortColumn))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
    const total = db.select({ n: count() }).from(products).where(where).get()?.n ?? 0;
    res.json({
      data: rows,
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
    });
  }),
);

/** Gợi ý hàng hóa cho combobox (phải đứng TRƯỚC /:id). */
productsRouter.get(
  '/suggest',
  asyncHandler(async (req, res) => {
    const q = z
      .object({ q: z.string().trim().default(''), limit: z.coerce.number().int().min(1).max(50).default(10) })
      .parse(req.query);
    const rows = getDb()
      .select()
      .from(products)
      .where(q.q ? productSearchCondition(q.q) : undefined)
      .orderBy(asc(products.code))
      .limit(q.limit)
      .all();
    // Ưu tiên mã khớp chính xác / bắt đầu bằng từ khoá lên đầu danh sách gợi ý
    if (q.q) {
      const key = codeKey(q.q);
      rows.sort((a, b) => {
        const ka = codeKey(a.code);
        const kb = codeKey(b.code);
        const rank = (k: string) => (k === key ? 0 : k.startsWith(key) ? 1 : k.includes(key) ? 2 : 3);
        return rank(ka) - rank(kb) || ka.length - kb.length;
      });
    }
    res.json(rows);
  }),
);

productsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = getDb().select().from(products).where(eq(products.id, id)).get();
    if (!row) throw notFound('Không tìm thấy hàng hóa');
    res.json(row);
  }),
);

productsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = productBody.parse(req.body);
    const code = normalizeCode(body.code);
    const db = getDb();
    const dup = db
      .select()
      .from(products)
      .all()
      .find((p) => normalizeCode(p.code) === code);
    if (dup) throw conflict('Mã hàng đã tồn tại', { id: dup.id, code: dup.code });
    const now = new Date().toISOString();
    const created = db
      .insert(products)
      .values({ ...body, code, createdAt: now, updatedAt: now })
      .returning()
      .get();
    writeAudit(req.user?.id ?? null, 'create', 'product', created.id, { code });
    res.status(201).json(created);
  }),
);

productsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = productBody.parse(req.body);
    const code = normalizeCode(body.code);
    const db = getDb();
    const existing = db.select().from(products).where(eq(products.id, id)).get();
    if (!existing) throw notFound('Không tìm thấy hàng hóa');
    const dup = db
      .select()
      .from(products)
      .all()
      .find((p) => p.id !== id && normalizeCode(p.code) === code);
    if (dup) throw conflict('Mã hàng đã tồn tại ở sản phẩm khác');
    const updated = db
      .update(products)
      .set({ ...body, code, updatedAt: new Date().toISOString() })
      .where(eq(products.id, id))
      .returning()
      .get();
    writeAudit(req.user?.id ?? null, 'update', 'product', id, { code });
    res.json(updated);
  }),
);

productsRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const existing = db.select().from(products).where(eq(products.id, id)).get();
    if (!existing) throw notFound('Không tìm thấy hàng hóa');
    const refCount =
      db.select({ n: count() }).from(invoiceLines).where(eq(invoiceLines.productId, id)).get()?.n ?? 0;
    if (refCount > 0) {
      throw conflict(`Không thể xóa: hàng hóa đang được ${refCount} dòng hóa đơn tham chiếu`);
    }
    db.delete(productAliases).where(eq(productAliases.productId, id)).run();
    db.delete(products).where(eq(products.id, id)).run();
    writeAudit(req.user?.id ?? null, 'delete', 'product', id, { code: existing.code });
    res.json({ ok: true });
  }),
);

export const __productsInternals = { and };
