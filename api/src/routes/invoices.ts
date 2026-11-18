import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  customers,
  invoiceLines,
  invoices,
  products,
  quotes,
  users,
} from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { asyncHandler } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import {
  duplicateCheck,
  lastPrice,
  taxToDb,
} from '../services/quotes.js';
import { exportInvoicesXlsx, type ExportInvoice } from '../services/invoice-export.js';
import { normalizeCode } from '../lib/normalize.js';

export const invoicesRouter: Router = Router();

const lineSchema = z.object({
  productId: z.number().int().positive('Vui lòng chọn hàng hóa'),
  qty: z.number().positive('Số lượng phải > 0'),
  unitPrice: z.number().int().min(0, 'Đơn giá phải >= 0'),
  taxRate: z.union([z.number().min(0).max(1), z.literal('KCT'), z.literal('KKKNT')]),
});

const invoiceBody = z.object({
  customerId: z.number().int().positive(),
  paymentMethod: z.string().trim().default('Chuyển khoản'),
  lines: z.array(lineSchema).min(1, 'Hóa đơn phải có ít nhất một dòng hàng'),
});

const listQuery = z.object({
  status: z.enum(['draft', 'exported']).optional(),
  customerId: z.coerce.number().int().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

function invoiceDetail(db: ReturnType<typeof getDb>, id: number) {
  const inv = db.select().from(invoices).where(eq(invoices.id, id)).get();
  if (!inv) return null;
  const customer = db.select().from(customers).where(eq(customers.id, inv.customerId)).get();
  const lines = db
    .select({
      id: invoiceLines.id,
      productId: invoiceLines.productId,
      qty: invoiceLines.qty,
      unitPrice: invoiceLines.unitPrice,
      taxRate: invoiceLines.taxRate,
      taxRateCode: invoiceLines.taxRateCode,
      sortOrder: invoiceLines.sortOrder,
      code: products.code,
      name: products.name,
      unit: products.unit,
    })
    .from(invoiceLines)
    .innerJoin(products, eq(invoiceLines.productId, products.id))
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(invoiceLines.sortOrder)
    .all();
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const vat = lines.reduce((s, l) => s + l.qty * l.unitPrice * (l.taxRate || 0), 0);
  return { ...inv, customer, lines, subtotal, vat, total: subtotal + vat };
}

invoicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const db = getDb();
    const conds = [];
    if (req.user!.role !== 'admin') conds.push(eq(invoices.createdBy, req.user!.id));
    if (q.status) conds.push(eq(invoices.status, q.status));
    if (q.customerId) conds.push(eq(invoices.customerId, q.customerId));
    if (q.from) conds.push(sql`${invoices.createdAt} >= ${q.from}`);
    if (q.to) conds.push(sql`${invoices.createdAt} <= ${q.to}`);
    const where = conds.length ? and(...conds) : undefined;
    const rows = db
      .select()
      .from(invoices)
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
    const total = db.select({ n: count() }).from(invoices).where(where).get()?.n ?? 0;
    const data = rows.map((inv) => {
      const cust = db.select().from(customers).where(eq(customers.id, inv.customerId)).get();
      const lineCount =
        db.select({ n: count() }).from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).get()?.n ?? 0;
      const sums = db
        .select({
          subtotal: sql<number>`COALESCE(SUM(${invoiceLines.qty} * ${invoiceLines.unitPrice}), 0)`,
        })
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, inv.id))
        .get();
      return {
        ...inv,
        customerName: cust?.name ?? '',
        customerTaxCode: cust?.taxCode ?? '',
        lineCount,
        subtotal: sums?.subtotal ?? 0,
      };
    });
    res.json({
      data,
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
    });
  }),
);

invoicesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const detail = invoiceDetail(db, id);
    if (!detail) throw notFound('Không tìm thấy hóa đơn');
    if (req.user!.role !== 'admin' && detail.createdBy !== req.user!.id) {
      throw notFound('Không tìm thấy hóa đơn');
    }
    res.json(detail);
  }),
);

invoicesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = invoiceBody.parse(req.body);
    const db = getDb();
    const customer = db.select().from(customers).where(eq(customers.id, body.customerId)).get();
    if (!customer) throw badRequest('Không tìm thấy khách hàng');
    for (const l of body.lines) {
      const p = db.select().from(products).where(eq(products.id, l.productId)).get();
      if (!p) throw badRequest(`Không tìm thấy hàng hóa id=${l.productId}`);
    }
    const now = new Date().toISOString();
    const created = db
      .insert(invoices)
      .values({
        customerId: body.customerId,
        paymentMethod: body.paymentMethod,
        status: 'draft',
        createdBy: req.user!.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    body.lines.forEach((l, i) => {
      db.insert(invoiceLines)
        .values({
          invoiceId: created.id,
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          taxRate: typeof l.taxRate === 'number' ? l.taxRate : 0,
          taxRateCode: typeof l.taxRate === 'number' ? null : l.taxRate,
          sortOrder: i,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
    writeAudit(req.user!.id, 'create', 'invoice', created.id, { lines: body.lines.length });
    res.status(201).json(invoiceDetail(db, created.id));
  }),
);

invoicesRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = invoiceBody.parse(req.body);
    const db = getDb();
    const inv = db.select().from(invoices).where(eq(invoices.id, id)).get();
    if (!inv) throw notFound('Không tìm thấy hóa đơn');
    if (req.user!.role !== 'admin' && inv.createdBy !== req.user!.id) {
      throw notFound('Không tìm thấy hóa đơn');
    }
    if (inv.status === 'exported' && req.user!.role !== 'admin') {
      throw conflict('Hóa đơn đã xuất, không thể sửa. Vui lòng liên hệ quản trị viên.');
    }
    const now = new Date().toISOString();
    db.update(invoices)
      .set({ customerId: body.customerId, paymentMethod: body.paymentMethod, updatedAt: now })
      .where(eq(invoices.id, id))
      .run();
    db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id)).run();
    body.lines.forEach((l, i) => {
      db.insert(invoiceLines)
        .values({
          invoiceId: id,
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          taxRate: typeof l.taxRate === 'number' ? l.taxRate : 0,
          taxRateCode: typeof l.taxRate === 'number' ? null : l.taxRate,
          sortOrder: i,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
    writeAudit(req.user!.id, 'update', 'invoice', id, {});
    res.json(invoiceDetail(db, id));
  }),
);

invoicesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const inv = db.select().from(invoices).where(eq(invoices.id, id)).get();
    if (!inv) throw notFound('Không tìm thấy hóa đơn');
    if (req.user!.role !== 'admin' && inv.createdBy !== req.user!.id) {
      throw notFound('Không tìm thấy hóa đơn');
    }
    db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id)).run();
    db.delete(invoices).where(eq(invoices.id, id)).run();
    writeAudit(req.user!.id, 'delete', 'invoice', id, {});
    res.json({ ok: true });
  }),
);

invoicesRouter.get(
  '/:id/duplicate-check',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    res.json({ warnings: duplicateCheck(id) });
  }),
);

const exportSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) });

invoicesRouter.post(
  '/export',
  asyncHandler(async (req, res) => {
    const { ids } = exportSchema.parse(req.body);
    const db = getDb();
    const items: ExportInvoice[] = [];
    for (const id of ids) {
      const inv = db.select().from(invoices).where(eq(invoices.id, id)).get();
      if (!inv) throw notFound(`Không tìm thấy hóa đơn id=${id}`);
      if (req.user!.role !== 'admin' && inv.createdBy !== req.user!.id) {
        throw notFound(`Không tìm thấy hóa đơn id=${id}`);
      }
      const cust = db.select().from(customers).where(eq(customers.id, inv.customerId)).get();
      if (!cust) throw badRequest(`Hóa đơn id=${id} thiếu khách hàng`);
      const lines = db
        .select({
          code: products.code,
          name: products.name,
          unit: products.unit,
          qty: invoiceLines.qty,
          unitPrice: invoiceLines.unitPrice,
          taxRate: invoiceLines.taxRate,
          taxRateCode: invoiceLines.taxRateCode,
        })
        .from(invoiceLines)
        .innerJoin(products, eq(invoiceLines.productId, products.id))
        .where(eq(invoiceLines.invoiceId, id))
        .orderBy(invoiceLines.sortOrder)
        .all();
      if (!lines.length) throw badRequest(`Hóa đơn id=${id} chưa có dòng hàng`);
      items.push({
        customer: {
          taxCode: cust.taxCode,
          buyerName: cust.buyerName,
          name: cust.name,
          address: cust.address,
          email: cust.email,
          bankAccount: cust.bankAccount,
          budgetUnitCode: cust.budgetUnitCode,
        },
        paymentMethod: inv.paymentMethod,
        lines: lines.map((l) => ({
          productCode: l.code,
          productName: l.name,
          unit: l.unit,
          qty: l.qty,
          unitPrice: l.unitPrice,
          taxRate: l.taxRateCode ?? l.taxRate,
        })),
      });
    }
    const now = new Date().toISOString();
    for (const id of ids) {
      db.update(invoices).set({ status: 'exported', exportedAt: now, updatedAt: now }).where(eq(invoices.id, id)).run();
    }
    writeAudit(req.user!.id, 'export', 'invoice', ids.join(','), { count: ids.length });
    await exportInvoicesXlsx(items, res);
  }),
);


export const __invoicesInternals = { and, count, desc, inArray, like, or, sql, taxToDb, users, quotes };
