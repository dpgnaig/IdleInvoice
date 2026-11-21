import { Router } from 'express';
import { and, asc, count, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { customerAliases, customers, invoices, quotes } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { normalizeTaxCode, normalizeText } from '../lib/normalize.js';
import { asyncHandler } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';

export const customersRouter: Router = Router();

const customerBody = z.object({
  taxCode: z.string().trim().min(1, 'Vui lòng nhập mã số thuế'),
  name: z.string().trim().min(1, 'Vui lòng nhập tên đơn vị'),
  address: z.string().trim().default(''),
  email: z.union([z.string().trim().email('Email không hợp lệ'), z.literal('')]).default(''),
  buyerName: z.string().trim().default(''),
  idCard: z.string().trim().default(''),
  bankAccount: z.string().trim().default(''),
  budgetUnitCode: z.string().trim().default(''),
  source: z.enum(['IMPORT', 'MANUAL', 'TAX_LOOKUP']).default('MANUAL'),
});

const listQuery = z.object({
  search: z.string().trim().optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  sort: z.string().optional().default('name'),
});

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const db = getDb();
    const term = `%${q.search}%`;
    const normTerm = `%${normalizeText(q.search)}%`;
    const where = q.search
      ? or(like(customers.taxCode, term), sql`norm_text(${customers.name}) LIKE ${normTerm}`)
      : undefined;
    const sortField = q.sort.startsWith('-') ? q.sort.slice(1) : q.sort;
    const sortColumn =
      sortField === 'taxCode'
        ? customers.taxCode
        : sortField === 'createdAt'
          ? customers.createdAt
          : customers.name;
    const dir = q.sort.startsWith('-') ? desc : asc;
    const rows = db
      .select()
      .from(customers)
      .where(where)
      .orderBy(dir(sortColumn))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
    const total = db.select({ n: count() }).from(customers).where(where).get()?.n ?? 0;
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

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = getDb().select().from(customers).where(eq(customers.id, id)).get();
    if (!row) throw notFound('Không tìm thấy khách hàng');
    res.json(row);
  }),
);

customersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = customerBody.parse(req.body);
    const taxCode = normalizeTaxCode(body.taxCode);
    const db = getDb();
    const dup = db.select().from(customers).where(eq(customers.taxCode, taxCode)).get();
    if (dup) throw conflict('Mã số thuế đã tồn tại', { id: dup.id, name: dup.name });
    const now = new Date().toISOString();
    const created = db
      .insert(customers)
      .values({ ...body, taxCode, createdAt: now, updatedAt: now })
      .returning()
      .get();
    writeAudit(req.user?.id ?? null, 'create', 'customer', created.id, { taxCode });
    res.status(201).json(created);
  }),
);

customersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = customerBody.parse(req.body);
    const taxCode = normalizeTaxCode(body.taxCode);
    const db = getDb();
    const existing = db.select().from(customers).where(eq(customers.id, id)).get();
    if (!existing) throw notFound('Không tìm thấy khách hàng');
    const dup = db
      .select()
      .from(customers)
      .where(and(eq(customers.taxCode, taxCode)))
      .get();
    if (dup && dup.id !== id) throw conflict('Mã số thuế đã tồn tại ở khách hàng khác');
    const updated = db
      .update(customers)
      .set({ ...body, taxCode, updatedAt: new Date().toISOString() })
      .where(eq(customers.id, id))
      .returning()
      .get();
    writeAudit(req.user?.id ?? null, 'update', 'customer', id, { taxCode });
    res.json(updated);
  }),
);

customersRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const existing = db.select().from(customers).where(eq(customers.id, id)).get();
    if (!existing) throw notFound('Không tìm thấy khách hàng');
    const invoiceRef = db.select({ n: count() }).from(invoices).where(eq(invoices.customerId, id)).get()?.n ?? 0;
    const quoteRef = db.select({ n: count() }).from(quotes).where(eq(quotes.customerId, id)).get()?.n ?? 0;
    if (invoiceRef > 0 || quoteRef > 0) {
      throw conflict(
        `Không thể xóa: khách hàng đang được ${invoiceRef} hóa đơn và ${quoteRef} báo giá tham chiếu`,
      );
    }
    db.delete(customerAliases).where(eq(customerAliases.customerId, id)).run();
    db.delete(customers).where(eq(customers.id, id)).run();
    writeAudit(req.user?.id ?? null, 'delete', 'customer', id, { taxCode: existing.taxCode });
    res.json({ ok: true });
  }),
);
