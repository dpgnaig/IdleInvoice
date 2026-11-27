import { Router } from 'express';
import multer from 'multer';
import { asc, count, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, getRawDb } from '../db/index.js';
import { salesHistory } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { codeKey, normalizeCode, normalizeTaxCode, normalizeText } from '../lib/normalize.js';
import { asyncHandler } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { parseHistoryWorkbook, readWorkbook } from '../services/excel-import.js';

export const salesHistoryRouter: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(new Error('Chỉ chấp nhận file .xlsx'));
    cb(null, true);
  },
});

const importKey = (r: {
  invoiceNo: string;
  invoiceDate: string | null;
  customerTaxCode: string;
  productCode: string;
  qty: number;
  unitPrice: number;
}) => [r.invoiceNo, r.invoiceDate ?? '', r.customerTaxCode, r.productCode, r.qty, r.unitPrice].join('|');

const dateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày hóa đơn không hợp lệ')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

const body = z.object({
  invoiceNo: z.string().trim().default(''),
  invoiceDate: dateField,
  customerTaxCode: z.string().trim().min(1, 'Vui lòng nhập mã số thuế khách hàng'),
  productCode: z.string().trim().min(1, 'Vui lòng nhập mã hàng'),
  productName: z.string().trim().min(1, 'Vui lòng nhập tên hàng'),
  unit: z.string().trim().default(''),
  qty: z.coerce.number().min(0, 'Số lượng không hợp lệ'),
  unitPrice: z.coerce.number().int('Đơn giá phải là số nguyên').min(0, 'Đơn giá không hợp lệ'),
  taxRate: z.coerce.number().min(0).max(1, 'Thuế suất không hợp lệ'),
});

const listQuery = z.object({
  search: z.string().trim().optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  sort: z.string().optional().default('-invoiceDate'),
});

function searchCondition(search: string) {
  const term = `%${search}%`;
  const key = codeKey(search);
  const parts = [
    like(salesHistory.invoiceNo, term),
    like(salesHistory.customerTaxCode, term),
    like(salesHistory.productCode, term),
    sql`norm_text(${salesHistory.productName}) LIKE ${`%${normalizeText(search)}%`}`,
  ];
  if (key) parts.push(sql`code_key(${salesHistory.productCode}) LIKE ${`%${key}%`}`);
  return or(...parts);
}

function normalizeBody(b: z.infer<typeof body>) {
  return {
    invoiceNo: b.invoiceNo,
    invoiceDate: b.invoiceDate || null,
    customerTaxCode: normalizeTaxCode(b.customerTaxCode),
    productCode: normalizeCode(b.productCode),
    productName: b.productName,
    unit: b.unit,
    qty: b.qty,
    unitPrice: b.unitPrice,
    taxRate: b.taxRate,
  };
}

/** Nhập file lịch sử hóa đơn ExportFast.xlsx; bỏ qua dòng đã có (trùng số HĐ, ngày, MST, mã hàng, SL, giá). */
salesHistoryRouter.post(
  '/import',
  requireRole('admin'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Vui lòng chọn file Excel');
    const sheets = await readWorkbook(req.file.buffer);
    const parsed = parseHistoryWorkbook(sheets);
    if (parsed.length === 0) throw badRequest('Không đọc được dòng lịch sử nào trong file');

    const existing = new Set(
      getDb()
        .select({
          invoiceNo: salesHistory.invoiceNo,
          invoiceDate: salesHistory.invoiceDate,
          customerTaxCode: salesHistory.customerTaxCode,
          productCode: salesHistory.productCode,
          qty: salesHistory.qty,
          unitPrice: salesHistory.unitPrice,
        })
        .from(salesHistory)
        .all()
        .map(importKey),
    );

    const raw = getRawDb();
    const now = new Date().toISOString();
    const stmt = raw.prepare(
      `INSERT INTO sales_history
       (created_at, updated_at, invoice_no, invoice_date, customer_tax_code, product_code, product_name, unit, qty, unit_price, tax_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let added = 0;
    let skipped = 0;
    raw.transaction(() => {
      for (const r of parsed) {
        const row = { ...r, productCode: normalizeCode(r.productCode) };
        if (existing.has(importKey(row))) {
          skipped++;
          continue;
        }
        stmt.run(now, now, row.invoiceNo, row.invoiceDate, row.customerTaxCode, row.productCode, row.productName, row.unit, row.qty, row.unitPrice, row.taxRate);
        added++;
      }
    })();
    writeAudit(req.user?.id ?? null, 'import', 'sales_history', 'import', { added, skipped, total: parsed.length });
    res.json({ ok: true, total: parsed.length, added, skipped });
  }),
);

salesHistoryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const db = getDb();
    const where = q.search ? searchCondition(q.search) : undefined;
    const field = q.sort.startsWith('-') ? q.sort.slice(1) : q.sort;
    const columns = {
      invoiceNo: salesHistory.invoiceNo,
      invoiceDate: salesHistory.invoiceDate,
      customerTaxCode: salesHistory.customerTaxCode,
      productCode: salesHistory.productCode,
      productName: salesHistory.productName,
      qty: salesHistory.qty,
      unitPrice: salesHistory.unitPrice,
      createdAt: salesHistory.createdAt,
    } as const;
    const sortColumn = columns[field as keyof typeof columns] ?? salesHistory.invoiceDate;
    const dir = q.sort.startsWith('-') ? desc : asc;
    const rows = db
      .select()
      .from(salesHistory)
      .where(where)
      .orderBy(dir(sortColumn), desc(salesHistory.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
    const total = db.select({ n: count() }).from(salesHistory).where(where).get()?.n ?? 0;
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

salesHistoryRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = getDb().select().from(salesHistory).where(eq(salesHistory.id, Number(req.params.id))).get();
    if (!row) throw notFound('Không tìm thấy dòng lịch sử bán hàng');
    res.json(row);
  }),
);

salesHistoryRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const values = normalizeBody(body.parse(req.body));
    const now = new Date().toISOString();
    const created = getDb()
      .insert(salesHistory)
      .values({ ...values, createdAt: now, updatedAt: now })
      .returning()
      .get();
    writeAudit(req.user?.id ?? null, 'create', 'sales_history', created.id, {
      customer: values.customerTaxCode,
      product: values.productCode,
    });
    res.status(201).json(created);
  }),
);

salesHistoryRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const values = normalizeBody(body.parse(req.body));
    const db = getDb();
    const existing = db.select().from(salesHistory).where(eq(salesHistory.id, id)).get();
    if (!existing) throw notFound('Không tìm thấy dòng lịch sử bán hàng');
    const updated = db
      .update(salesHistory)
      .set({ ...values, updatedAt: new Date().toISOString() })
      .where(eq(salesHistory.id, id))
      .returning()
      .get();
    writeAudit(req.user?.id ?? null, 'update', 'sales_history', id, {
      customer: values.customerTaxCode,
      product: values.productCode,
    });
    res.json(updated);
  }),
);

salesHistoryRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const existing = db.select().from(salesHistory).where(eq(salesHistory.id, id)).get();
    if (!existing) throw notFound('Không tìm thấy dòng lịch sử bán hàng');
    db.delete(salesHistory).where(eq(salesHistory.id, id)).run();
    writeAudit(req.user?.id ?? null, 'delete', 'sales_history', id, {
      customer: existing.customerTaxCode,
      product: existing.productCode,
    });
    res.json({ ok: true });
  }),
);
