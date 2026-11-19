import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb, getRawDb } from '../db/index.js';
import { customers, products, salesHistory, users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { hashPassword, passwordProblems } from '../lib/password.js';
import { isSetupCompleted, setSetting } from '../lib/settings.js';
import { writeAudit } from '../lib/audit.js';
import { asyncHandler } from '../middleware/error.js';
import {
  parseCustomerSheet,
  parseProductSheet,
  parseHistoryWorkbook,
  readWorkbook,
} from '../services/excel-import.js';

const UPLOAD_ROOT = process.env.UPLOAD_DIR ?? './uploads';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname);
    if (!ok) return cb(new Error('Chỉ chấp nhận file .xlsx'));
    cb(null, true);
  },
});

export const setupRouter: Router = Router();

/** Sau khi hoàn tất setup, toàn bộ /api/setup/* trả 403 vĩnh viễn. */
setupRouter.use((_req, _res, next) => {
  if (isSetupCompleted()) return next(forbidden('Hệ thống đã hoàn tất thiết lập, chức năng này đã bị khóa'));
  next();
});

setupRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const admin = db
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.role, 'admin'))
      .get();
    const customerCount = db.select({ id: customers.id }).from(customers).all().length;
    const productCount = db.select({ id: products.id }).from(products).all().length;
    const historyCount = db.select({ id: salesHistory.id }).from(salesHistory).all().length;
    res.json({
      setupCompleted: isSetupCompleted(),
      hasAdmin: Boolean(admin),
      adminEmail: admin?.email ?? null,
      step: admin ? (customerCount > 0 || productCount > 0 ? 3 : 2) : 1,
      counts: { customers: customerCount, products: productCount, history: historyCount },
    });
  }),
);

const adminSchema = z.object({
  fullName: z.string().trim().min(2, 'Vui lòng nhập họ tên'),
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự'),
});

setupRouter.post(
  '/admin',
  asyncHandler(async (req, res) => {
    const body = adminSchema.parse(req.body);
    const problems = passwordProblems(body.password);
    if (problems.length) throw badRequest('Mật khẩu chưa đủ mạnh', problems);
    const db = getDb();
    const existingAdmin = db.select().from(users).where(eq(users.role, 'admin')).get();
    if (existingAdmin) {
      // Cho phép tiếp tục wizard nếu admin đã tạo ở lần trước.
      res.json({ ok: true, message: 'Tài khoản quản trị đã tồn tại', email: existingAdmin.email });
      return;
    }
    const dup = db.select().from(users).where(eq(users.email, body.email)).get();
    if (dup) throw badRequest('Email đã được sử dụng');
    const now = new Date().toISOString();
    const created = db
      .insert(users)
      .values({
        email: body.email,
        fullName: body.fullName,
        passwordHash: await hashPassword(body.password),
        role: 'admin',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    writeAudit(created.id, 'setup_admin_created', 'user', created.id, {});
    res.status(201).json({ ok: true, message: 'Đã tạo tài khoản quản trị' });
  }),
);

function setupUploadDir(): string {
  const dir = join(UPLOAD_ROOT, 'setup');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

setupRouter.post(
  '/import/preview',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Vui lòng chọn file Excel');
    req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const sheets = await readWorkbook(req.file.buffer);
    const customerSheet =
      sheets.find((s) => /dskh|khach/i.test(s.name)) ??
      sheets.find((s) => s.rows.some((r) => r.cells.some((c) => /mã số thuế/i.test(c))));
    const productSheet =
      sheets.find((s) => /dshh|dssp|hang/i.test(s.name)) ??
      sheets.find((s) => s.rows.some((r) => r.cells.some((c) => /mã hàng hóa/i.test(c))));

    const customerParsed = customerSheet
      ? parseCustomerSheet(customerSheet)
      : { rows: [], issues: [{ rowNumber: 0, reason: 'Không tìm thấy sheet DSKH' }], duplicateCount: 0 };
    const productParsed = productSheet
      ? parseProductSheet(productSheet)
      : { rows: [], issues: [{ rowNumber: 0, reason: 'Không tìm thấy sheet DSSP' }], duplicateCount: 0 };

    const db = getDb();
    const existingTax = new Set(db.select({ t: customers.taxCode }).from(customers).all().map((r) => r.t));
    const existingCodes = new Set(
      db.select({ c: products.code }).from(products).all().map((r) => r.c.toUpperCase()),
    );
    // Gắn cờ "đã có trong DB" cho từng dòng — trả về đủ mọi dòng (kể cả lỗi/trùng)
    // để giao diện hiển thị và tô sáng toàn bộ file đã đọc.
    const customerRows = customerParsed.rows.map((r) => ({ ...r, duplicateInDb: existingTax.has(r.taxCode) }));
    const productRows = productParsed.rows.map((r) => ({ ...r, duplicateInDb: existingCodes.has(r.code.toUpperCase()) }));
    const dupInDb = customerRows.filter((r) => r.duplicateInDb).length;
    const dupProductInDb = productRows.filter((r) => r.duplicateInDb).length;
    const customerAddable = customerRows.filter((r) => r.status === 'ok' && !r.duplicateInDb).length;
    const productAddable = productRows.filter((r) => r.status === 'ok' && !r.duplicateInDb).length;

    // Lưu file để bước commit không phụ thuộc trình duyệt còn mở hay không.
    const id = crypto.randomUUID();
    writeFileSync(join(setupUploadDir(), `${id}.xlsx`), req.file.buffer);

    res.json({
      uploadId: id,
      fileName: req.file.originalname,
      customers: {
        total: customerRows.length,
        valid: customerAddable,
        duplicateInFile: customerParsed.duplicateCount,
        duplicateInDb: dupInDb,
        invalid: customerRows.filter((r) => r.status === 'invalid').length,
        rows: customerRows,
        sample: customerRows.slice(0, 10),
        issues: customerParsed.issues.slice(0, 500),
        issueCount: customerParsed.issues.length,
      },
      products: {
        total: productRows.length,
        valid: productAddable,
        duplicateInFile: productParsed.duplicateCount,
        duplicateInDb: dupProductInDb,
        invalid: productRows.filter((r) => r.status === 'invalid').length,
        rows: productRows,
        sample: productRows.slice(0, 10),
        issues: productParsed.issues.slice(0, 500),
        issueCount: productParsed.issues.length,
      },
    });
  }),
);

const commitSchema = z.object({ uploadId: z.string().uuid() });

setupRouter.post(
  '/import/commit',
  asyncHandler(async (req, res) => {
    const { uploadId } = commitSchema.parse(req.body);
    const file = join(setupUploadDir(), `${uploadId}.xlsx`);
    if (!existsSync(file)) throw notFound('Không tìm thấy file đã tải lên, vui lòng tải lại');
    const sheets = await readWorkbook(readFileSync(file));
    const customerSheet =
      sheets.find((s) => /dskh|khach/i.test(s.name)) ??
      sheets.find((s) => s.rows.some((r) => r.cells.some((c) => /mã số thuế/i.test(c))));
    const productSheet =
      sheets.find((s) => /dshh|dssp|hang/i.test(s.name)) ??
      sheets.find((s) => s.rows.some((r) => r.cells.some((c) => /mã hàng hóa/i.test(c))));
    const customerParsed = customerSheet ? parseCustomerSheet(customerSheet) : { rows: [], issues: [], duplicateCount: 0 };
    const productParsed = productSheet ? parseProductSheet(productSheet) : { rows: [], issues: [], duplicateCount: 0 };

    const db = getDb();
    const raw = getRawDb();
    let customersAdded = 0;
    let productsAdded = 0;
    const now = new Date().toISOString();

    const tx = raw.transaction(() => {
      const insertCustomer = raw.prepare(
        `INSERT OR IGNORE INTO customers
         (created_at, updated_at, tax_code, name, address, email, buyer_name, id_card, bank_account, budget_unit_code, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IMPORT')`,
      );
      for (const c of customerParsed.rows) {
        if (c.status !== 'ok') continue;
        const r = insertCustomer.run(now, now, c.taxCode, c.name, c.address, c.email, c.buyerName, c.idCard, c.bankAccount, c.budgetUnitCode);
        customersAdded += r.changes;
      }
      const insertProduct = raw.prepare(
        `INSERT OR IGNORE INTO products (created_at, updated_at, code, name, unit) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const p of productParsed.rows) {
        if (p.status !== 'ok') continue;
        const r = insertProduct.run(now, now, p.code, p.name, p.unit);
        productsAdded += r.changes;
      }
    });
    tx();

    writeAudit(null, 'setup_import', 'catalog', uploadId, {
      customersAdded,
      productsAdded,
      customerIssues: customerParsed.issues.length,
      productIssues: productParsed.issues.length,
    });

    res.json({
      ok: true,
      customersAdded,
      productsAdded,
      customersSkipped: customerParsed.rows.length - customersAdded,
      productsSkipped: productParsed.rows.length - productsAdded,
      issues: [...customerParsed.issues, ...productParsed.issues].slice(0, 500),
      db: db !== null,
    });
  }),
);

const historySchema = z.object({ uploadId: z.string().uuid() });

setupRouter.post(
  '/import/history/preview',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Vui lòng chọn file Excel');
    const sheets = await readWorkbook(req.file.buffer);
    const rows = parseHistoryWorkbook(sheets);
    const id = crypto.randomUUID();
    writeFileSync(join(setupUploadDir(), `${id}.xlsx`), req.file.buffer);
    res.json({
      uploadId: id,
      total: rows.length,
      sample: rows.slice(0, 10),
      sheetNames: sheets.map((s) => s.name),
    });
  }),
);

setupRouter.post(
  '/import/history/commit',
  asyncHandler(async (req, res) => {
    const { uploadId } = historySchema.parse(req.body);
    const file = join(setupUploadDir(), `${uploadId}.xlsx`);
    if (!existsSync(file)) throw notFound('Không tìm thấy file đã tải lên');
    const sheets = await readWorkbook(readFileSync(file));
    const rows = parseHistoryWorkbook(sheets);
    const raw = getRawDb();
    const now = new Date().toISOString();
    let added = 0;
    const stmt = raw.prepare(
      `INSERT INTO sales_history
       (created_at, updated_at, invoice_no, invoice_date, customer_tax_code, product_code, product_name, unit, qty, unit_price, tax_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    raw.transaction(() => {
      for (const r of rows) {
        stmt.run(now, now, r.invoiceNo, r.invoiceDate, r.customerTaxCode, r.productCode, r.productName, r.unit, r.qty, r.unitPrice, r.taxRate);
        added++;
      }
    })();
    writeAudit(null, 'setup_import_history', 'sales_history', uploadId, { added });
    res.json({ ok: true, added });
  }),
);

setupRouter.post(
  '/complete',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const admin = db.select().from(users).where(eq(users.role, 'admin')).get();
    if (!admin) throw badRequest('Chưa có tài khoản quản trị, vui lòng hoàn tất bước 1');
    setSetting('setup_completed', 'true');
    writeAudit(admin.id, 'setup_completed', 'app_settings', 'setup_completed', {});
    res.json({ ok: true });
  }),
);

export const __setupInternals = { and, dirname, getEnv };
