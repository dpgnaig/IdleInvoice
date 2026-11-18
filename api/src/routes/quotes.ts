import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, existsSync, writeFileSync, createReadStream } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { z } from 'zod';
import { and, count, desc, eq, like, or } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { invoices, invoiceLines, quoteFiles, quotes, customers, products } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { asyncHandler } from '../middleware/error.js';
import { parseWithPython } from '../services/parser-client.js';
import { buildDraft, confirmDraft, sha256 } from '../services/quotes.js';

const UPLOAD_ROOT = process.env.UPLOAD_DIR ?? './uploads';

function uploadDir(): string {
  const dir = join(UPLOAD_ROOT, 'quotes');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(pdf|xlsx|xls)$/i.test(file.originalname);
    if (!ok) return cb(new Error('Chỉ chấp nhận file .pdf, .xlsx, .xls'));
    cb(null, true);
  },
});

export const quotesRouter: Router = Router();

function db_file(hash: string) {
  return getDb().select().from(quoteFiles).where(eq(quoteFiles.fileHash, hash)).get();
}

function mimeFor(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/vnd.ms-excel';
}

/** Lưu file với tên ngẫu nhiên (không tin tên gốc). */
function storeFile(buffer: Buffer, originalName: string, fileHash: string): string {
  const ext = (/\.(pdf|xlsx|xls)$/i.exec(originalName)?.[1] ?? 'bin').toLowerCase();
  const stored = join(uploadDir(), `${fileHash}.${ext}`);
  if (!existsSync(stored)) writeFileSync(stored, buffer);
  return stored;
}

quotesRouter.post(
  '/parse',
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];
    if (!files.length) throw badRequest('Vui lòng chọn ít nhất một file báo giá');
    const db = getDb();
    const drafts: unknown[] = [];

    for (const f of files) {
      // multer giải mã tên file theo latin1 -> đổi về UTF-8 để giữ tiếng Việt
      f.originalname = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const fileHash = sha256(f.buffer);
      const parsed = await parseWithPython(f.buffer, f.originalname, mimeFor(f.originalname));

      if (!parsed.ok) {
        // Ghi nhận file lỗi để người dùng thấy và thử lại
        const now = new Date().toISOString();
        db.insert(quoteFiles)
          .values({
            originalName: f.originalname,
            storedPath: '',
            fileHash: `${fileHash}-${now}`, // hash riêng để không chặn lần tải lại
            uploadedBy: req.user!.id,
            parseStatus: 'failed',
            errorMessage: parsed.message,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
        drafts.push({
          fileHash,
          originalName: f.originalname,
          status: 'failed',
          error: parsed.error,
          errorCode: parsed.errorCode,
          message: parsed.message,
        });
        continue;
      }

      const storedPath = storeFile(f.buffer, f.originalname, fileHash);
      const existingFile = db.select().from(quoteFiles).where(eq(quoteFiles.fileHash, fileHash)).get();
      const now = new Date().toISOString();
      if (existingFile) {
        db.update(quoteFiles)
          .set({
            parseStatus: 'parsed',
            parsedJson: JSON.stringify(parsed.data),
            errorMessage: null,
            updatedAt: now,
          })
          .where(eq(quoteFiles.id, existingFile.id))
          .run();
      } else {
        db.insert(quoteFiles)
          .values({
            originalName: f.originalname,
            storedPath,
            fileHash,
            uploadedBy: req.user!.id,
            parseStatus: 'parsed',
            parsedJson: JSON.stringify(parsed.data),
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      const draft = buildDraft(parsed.data, f.originalname, fileHash);
      if (existingFile) {
        draft.warnings.unshift(
          `File "${f.originalname}" đã được tải lên trước đó (trùng nội dung) — kiểm tra trước khi xác nhận`,
        );
      }
      const needsReview =
        draft.customerMatch.status !== 'matched' ||
        draft.lines.some((l) => l.productMatch.status !== 'matched');
      if (needsReview && existingFile) {
        db.update(quoteFiles)
          .set({ parseStatus: 'needs_review', updatedAt: new Date().toISOString() })
          .where(eq(quoteFiles.id, existingFile.id))
          .run();
      }

      drafts.push({
        fileHash,
        originalName: f.originalname,
        status: needsReview ? 'needs_review' : 'parsed',
        duplicateFile: Boolean(existingFile),
        customerMatch: draft.customerMatch,
        lines: draft.lines,
        warnings: draft.warnings,
        parsed: {
          buyerName: draft.parsed.buyer_name,
          buyerTaxCode: draft.parsed.buyer_tax_code,
          quoteNo: draft.parsed.quote_no,
          quoteDate: draft.parsed.quote_date,
          senderName: draft.parsed.sender_name,
          receiverName: draft.parsed.receiver_name,
          declaredSubtotal: draft.parsed.declared_subtotal,
          declaredVat: draft.parsed.declared_vat,
          declaredTotal: draft.parsed.declared_total,
          taxRate: draft.parsed.tax_rate,
          paymentTerms: draft.parsed.payment_terms,
          validityDays: draft.parsed.validity_days,
        },
      });
    }

    res.json({ drafts });
  }),
);

const confirmLineSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().positive('Số lượng phải > 0'),
  unitPrice: z.number().int().min(0),
  taxRate: z.union([z.number().min(0).max(1), z.literal('KCT'), z.literal('KKKNT')]).default(0.08),
  rememberAlias: z.boolean().optional().default(false),
  aliasText: z.string().optional(),
});

const confirmSchema = z.object({
  quoteNo: z.string().trim().min(1, 'Số báo giá không được để trống'),
  quoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày báo giá phải dạng yyyy-mm-dd').nullable().default(null),
  customerId: z.number().int().positive('Vui lòng chọn khách hàng'),
  fileHash: z.string().min(1),
  declaredSubtotal: z.number().int().nullable().default(null),
  declaredVat: z.number().int().nullable().default(null),
  declaredTotal: z.number().int().nullable().default(null),
  validityDays: z.number().int().nullable().default(null),
  note: z.string().optional().default(''),
  lines: z.array(confirmLineSchema).min(1, 'Cần ít nhất một dòng hàng'),
  rememberCustomerAlias: z.boolean().optional().default(false),
  aliasText: z.string().optional(),
});

quotesRouter.post(
  '/confirm',
  asyncHandler(async (req, res) => {
    const payload = confirmSchema.parse(req.body);
    const db = getDb();

    const dupQuote = db.select().from(quotes).where(eq(quotes.quoteNo, payload.quoteNo)).get();
    if (dupQuote) throw conflict(`Số báo giá "${payload.quoteNo}" đã tồn tại`, { id: dupQuote.id });

    const customer = db.select().from(customers).where(eq(customers.id, payload.customerId)).get();
    if (!customer) throw badRequest('Không tìm thấy khách hàng đã chọn');

    for (const l of payload.lines) {
      const p = db.select().from(products).where(eq(products.id, l.productId)).get();
      if (!p) throw badRequest(`Không tìm thấy hàng hóa id=${l.productId}`);
    }

    const qf = db.select().from(quoteFiles).where(eq(quoteFiles.fileHash, payload.fileHash)).get();
    const parsed = qf?.parsedJson ? (JSON.parse(qf.parsedJson) as never) : null;

    const result = confirmDraft(payload as never, req.user!.id, parsed);
    writeAudit(req.user!.id, 'create', 'quote', result.quote.id, {
      invoiceId: result.invoice.id,
      quoteNo: payload.quoteNo,
      lines: payload.lines.length,
    });

    res.status(201).json({ quote: result.quote, invoice: result.invoice });
  }),
);

const listQuery = z.object({
  search: z.string().trim().optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

quotesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const db = getDb();
    const where = q.search ? like(quotes.quoteNo, `%${q.search}%`) : undefined;
    const rows = db
      .select()
      .from(quotes)
      .where(where)
      .orderBy(desc(quotes.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
    const total = db.select({ n: count() }).from(quotes).where(where).get()?.n ?? 0;
    const data = rows.map((r) => {
      const cust = r.customerId
        ? db.select().from(customers).where(eq(customers.id, r.customerId)).get()
        : null;
      const inv = db.select().from(invoices).where(eq(invoices.quoteId, r.id)).get();
      return {
        ...r,
        customerName: cust?.name ?? '',
        customerTaxCode: cust?.taxCode ?? '',
        invoiceId: inv?.id ?? null,
        invoiceStatus: inv?.status ?? null,
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

/** Trả file báo giá gốc đã lưu (để xem trước trong UI). Đăng ký TRƯỚC /:id. */
quotesRouter.get(
  '/file/:hash',
  asyncHandler(async (req, res) => {
    const hash = String(req.params.hash);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw badRequest('Mã file không hợp lệ');
    const file = db_file(hash);
    if (!file) throw notFound('Không tìm thấy file báo giá');
    const abs = pathResolve(file.storedPath);
    if (!existsSync(abs)) throw notFound('File gốc không còn trên đĩa');
    const ext = /\.([a-z0-9]+)$/i.exec(file.originalName)?.[1]?.toLowerCase() ?? 'bin';
    const mime = mimeFor(`x.${ext}`);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
    createReadStream(abs).pipe(res);
  }),
);

quotesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const quote = db.select().from(quotes).where(eq(quotes.id, id)).get();
    if (!quote) throw notFound('Không tìm thấy báo giá');
    const cust = quote.customerId
      ? db.select().from(customers).where(eq(customers.id, quote.customerId)).get()
      : null;
    const file = quote.quoteFileId
      ? db.select().from(quoteFiles).where(eq(quoteFiles.id, quote.quoteFileId)).get()
      : null;
    const inv = db.select().from(invoices).where(eq(invoices.quoteId, quote.id)).get();
    const lines = inv
      ? db
          .select({
            id: invoiceLines.id,
            productId: invoiceLines.productId,
            qty: invoiceLines.qty,
            unitPrice: invoiceLines.unitPrice,
            taxRate: invoiceLines.taxRate,
            code: products.code,
            name: products.name,
            unit: products.unit,
          })
          .from(invoiceLines)
          .innerJoin(products, eq(invoiceLines.productId, products.id))
          .where(eq(invoiceLines.invoiceId, inv.id))
          .orderBy(invoiceLines.sortOrder)
          .all()
      : [];
    res.json({
      quote,
      customer: cust,
      file: file ? { originalName: file.originalName, parseStatus: file.parseStatus } : null,
      invoice: inv ?? null,
      lines,
    });
  }),
);

quotesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const quote = db.select().from(quotes).where(eq(quotes.id, id)).get();
    if (!quote) throw notFound('Không tìm thấy báo giá');
    const inv = db.select().from(invoices).where(eq(invoices.quoteId, id)).get();
    if (inv) {
      if (inv.status === 'exported') {
        throw conflict('Không thể xóa: hóa đơn của báo giá này đã xuất');
      }
      db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).run();
      db.delete(invoices).where(eq(invoices.id, inv.id)).run();
    }
    db.delete(quotes).where(eq(quotes.id, id)).run();
    writeAudit(req.user!.id, 'delete', 'quote', id, { quoteNo: quote.quoteNo });
    res.json({ ok: true });
  }),
);

export const __quotesInternals = { and, or };
