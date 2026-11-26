import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, existsSync, readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { z } from 'zod';
import { and, count, desc, eq, like, or } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { invoices, invoiceLines, quoteFiles, quotes, customers, products } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { normalizeTaxCode } from '../lib/normalize.js';
import { asyncHandler } from '../middleware/error.js';
import { parseWithPython, previewWithPython } from '../services/parser-client.js';
import { enrichWithAi, type AiEnrichment, type AiFuzzyHints, type LineSuggestion } from '../services/ai-enrich.js';
import { fuzzyEnrich, type FuzzyResult } from '../services/fuzzy-enrich.js';
import { createJob, finishJob, getJob, jobView, updateFile } from '../services/quote-jobs.js';
import { aiEnabled } from '../services/ai.js';
import { matchQuote, buildDraft, confirmDraft, lookupDraftCustomer, sha256 } from '../services/quotes.js';

const UPLOAD_ROOT = process.env.UPLOAD_DIR ?? './uploads';

function uploadDir(): string {
  const dir = join(UPLOAD_ROOT, 'quotes');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 50 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(pdf|xlsx|xls|docx?)$/i.test(file.originalname);
    if (!ok) return cb(new Error('Chỉ chấp nhận file .pdf, .xlsx, .xls, .doc, .docx'));
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
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (n.endsWith('.doc')) return 'application/msword';
  if (n.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/vnd.ms-excel';
}

/** Lưu file với tên ngẫu nhiên (không tin tên gốc). */
function storeFile(buffer: Buffer, originalName: string, fileHash: string): string {
  const ext = (/\.(pdf|xlsx|xls|docx?)$/i.exec(originalName)?.[1] ?? 'bin').toLowerCase();
  const stored = join(uploadDir(), `${fileHash}.${ext}`);
  if (!existsSync(stored)) writeFileSync(stored, buffer);
  return stored;
}

/** Gộp kết quả rapidfuzz (nền) với AI (ghi đè); đủ để buildDraft áp vào nháp. */
function mergeEnrichment(fuzzy?: FuzzyResult, ai?: AiEnrichment): AiEnrichment | undefined {
  if (!fuzzy && !ai) return undefined;
  const lines: Record<number, LineSuggestion> = { ...(fuzzy?.lines ?? {}) };
  for (const [k, s] of Object.entries(ai?.lines ?? {})) {
    const idx = Number(k);
    lines[idx] = { ...(lines[idx] ?? {}), ...s };
  }
  return {
    customer: ai?.customer ?? fuzzy?.customer,
    lines,
    status: ai?.status ?? { ran: false, providers: [], notes: [] },
  };
}

/** Xử lý nền một phiên tải lên: cập nhật tiến trình từng file để UI poll. */
async function processQuoteFiles(
  jobId: string,
  files: Express.Multer.File[],
  userId: number,
): Promise<void> {
  const db = getDb();
  const aiOn = getJob(jobId)?.aiEnabled ?? false;

  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    try {
      updateFile(jobId, i, { stage: 'parsing', pct: 15 });
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
            uploadedBy: userId,
            parseStatus: 'failed',
            errorMessage: parsed.message,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
        updateFile(jobId, i, {
          stage: 'error',
          pct: 100,
          message: parsed.message,
          draft: {
            fileHash,
            originalName: f.originalname,
            status: 'failed',
            error: parsed.error,
            errorCode: parsed.errorCode,
            message: parsed.message,
          },
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
            uploadedBy: userId,
            parseStatus: 'parsed',
            parsedJson: JSON.stringify(parsed.data),
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      // Ghép tất định trước, rồi tìm tương tự (rapidfuzz), cuối cùng mới tới AI
      updateFile(jobId, i, { stage: 'matching', pct: 35 });
      const base = matchQuote(parsed.data);
      updateFile(jobId, i, { stage: 'fuzzy', pct: 50 });
      const fuzzy = await fuzzyEnrich(parsed.data, base.lines.map((l) => l.productMatch));
      if (aiOn) updateFile(jobId, i, { stage: 'ai', pct: 65 });
      const hints: AiFuzzyHints | undefined = fuzzy
        ? {
            customerShortlist: fuzzy.customerShortlist,
            candidates: fuzzy.candidates,
            skipCustomer: fuzzy.resolvedCustomer,
            resolvedLineIndexes: Object.keys(fuzzy.lines).map(Number),
          }
        : undefined;
      const ai = await enrichWithAi(parsed.data, base.lines.map((l) => l.productMatch), hints);
      // Hiện provider đã dùng ngay trên thanh tiến trình, trước khi bước tra MST xong
      if (ai?.status.providers.length) {
        updateFile(jobId, i, { aiProviders: ai.status.providers });
      }
      const enrichment = mergeEnrichment(fuzzy, ai);
      const draft = buildDraft(parsed.data, f.originalname, fileHash, enrichment, base);

      // MST có trong file nhưng chưa có trong DSKH -> tra VietQR (không phụ thuộc AI)
      updateFile(jobId, i, { stage: 'tax_lookup', pct: 80 });
      const needsTaxLookup =
        draft.customerMatch.status !== 'matched' && normalizeTaxCode(parsed.data.buyer_tax_code).length >= 10;
      const looked = needsTaxLookup ? await lookupDraftCustomer(parsed.data) : null;
      if (looked?.info) {
        draft.warnings.push(
          `Tra cứu VietQR MST ${looked.info.taxCode}: ${looked.info.name}${looked.info.address ? ` — ${looked.info.address}` : ''}`,
        );
      } else if (looked?.warning) {
        draft.warnings.push(looked.warning);
      }

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

      // Khách AI tìm ra (ngoài danh mục) -> tự thêm vào DSKH và gắn vào báo giá
      let customerSuggestion: Record<string, unknown> | null = null;
      const suggestionInfo =
        ai?.customer?.customerMatch.status === 'new_customer' && ai.customer.info
          ? ai.customer.info
          : looked?.info ?? null;
      if (suggestionInfo) {
        const info = suggestionInfo;
        if (process.env.AUTO_ADD_CUSTOMER === 'false') {
          customerSuggestion = info;
        } else {
          const nowIso = new Date().toISOString();
          const created = db
            .insert(customers)
            .values({
              taxCode: normalizeTaxCode(info.taxCode),
              name: info.name,
              address: info.address ?? '',
              source: 'TAX_LOOKUP',
              createdAt: nowIso,
              updatedAt: nowIso,
            })
            .onConflictDoNothing()
            .returning()
            .get();
          const row = created ?? db.select().from(customers).where(eq(customers.taxCode, normalizeTaxCode(info.taxCode))).get();
          if (row) {
            draft.customerMatch = {
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
              method: 'ai_tax_lookup',
            };
            draft.warnings.push(
              created
                ? `Đã thêm khách hàng mới "${row.name}" (MST ${row.taxCode}) vào danh mục`
                : `Khách hàng MST ${row.taxCode} đã có trong danh mục`,
            );
          }
        }
      }

      updateFile(jobId, i, {
        stage: 'done',
        pct: 100,
        draft: {
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
          ai: ai
            ? {
                ran: ai.status.ran,
                lines: ai.status.lines ?? 0,
                notes: ai.status.notes,
                providers: ai.status.providers,
              }
            : null,
          customerSuggestion,
        },
      });
    } catch (err) {
      logger.error({ err, file: f.originalname }, 'Lỗi xử lý báo giá');
      updateFile(jobId, i, {
        stage: 'error',
        pct: 100,
        message: err instanceof Error ? err.message : 'Lỗi xử lý file',
      });
    }
  }

  finishJob(jobId);
}

quotesRouter.post(
  '/parse',
  upload.array('files', 50),
  asyncHandler(async (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];
    if (!files.length) throw badRequest('Vui lòng chọn ít nhất một file báo giá');
    // multer giải mã tên file theo latin1 -> đổi về UTF-8 để giữ tiếng Việt
    for (const f of files) {
      f.originalname = Buffer.from(f.originalname, 'latin1').toString('utf8');
    }

    const job = createJob(files.map((f) => f.originalname), aiEnabled());
    res.status(202).json({ jobId: job.id });
    // Trả jobId trước, xử lý tiếp ở nền; lỗi từng file được ghi vào job
    void processQuoteFiles(job.id, files, req.user!.id).catch((err) => {
      logger.error({ err, jobId: job.id }, 'Phiên xử lý báo giá thất bại');
      finishJob(job.id);
    });
  }),
);

/** Trạng thái xử lý của một phiên tải lên (UI poll tới khi status = done). */
quotesRouter.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = getJob(String(req.params.id));
    if (!job) throw notFound('Không tìm thấy phiên xử lý');
    res.json(jobView(job));
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
  quoteNo: z.string().trim().max(120).optional().default(''),
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

/** Mã báo giá tự sinh khi người dùng để trống; đảm bảo không trùng. */
function nextQuoteNo(db: ReturnType<typeof getDb>): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let n = 1; n <= 999; n++) {
    const candidate = `BG-${day}-${String(n).padStart(3, '0')}`;
    if (!db.select({ id: quotes.id }).from(quotes).where(eq(quotes.quoteNo, candidate)).get()) {
      return candidate;
    }
  }
  return `BG-${Date.now()}`;
}

quotesRouter.post(
  '/confirm',
  asyncHandler(async (req, res) => {
    const payload = confirmSchema.parse(req.body);
    const db = getDb();

    const qf = db.select().from(quoteFiles).where(eq(quoteFiles.fileHash, payload.fileHash)).get();
    const parsed = qf?.parsedJson ? (JSON.parse(qf.parsedJson) as never) : null;

    // Số báo giá không bắt buộc: lấy số đọc được từ file, nếu vẫn trống thì tự sinh
    if (!payload.quoteNo) {
      const fromFile = String((parsed as { quote_no?: string } | null)?.quote_no ?? '').trim();
      const available =
        fromFile && !db.select().from(quotes).where(eq(quotes.quoteNo, fromFile)).get();
      payload.quoteNo = available ? fromFile : nextQuoteNo(db);
    }

    const dupQuote = db.select().from(quotes).where(eq(quotes.quoteNo, payload.quoteNo)).get();
    if (dupQuote) throw conflict(`Số báo giá "${payload.quoteNo}" đã tồn tại`, { id: dupQuote.id });

    const customer = db.select().from(customers).where(eq(customers.id, payload.customerId)).get();
    if (!customer) throw badRequest('Không tìm thấy khách hàng đã chọn');

    for (const l of payload.lines) {
      const p = db.select().from(products).where(eq(products.id, l.productId)).get();
      if (!p) throw badRequest(`Không tìm thấy hàng hóa id=${l.productId}`);
    }

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

/** Xem trước nội dung file Excel/Word (PDF dùng iframe trực tiếp). Đăng ký TRƯỚC /:id. */
quotesRouter.get(
  '/preview/:hash',
  asyncHandler(async (req, res) => {
    const hash = String(req.params.hash);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw badRequest('Mã file không hợp lệ');
    const file = db_file(hash);
    if (!file) throw notFound('Không tìm thấy file báo giá');
    const abs = pathResolve(file.storedPath);
    if (!existsSync(abs)) throw notFound('File gốc không còn trên đĩa');
    if (!/\.(xlsx|xls|docx?)$/i.test(file.originalName)) {
      throw badRequest('Chỉ xem trước được file Excel và Word');
    }
    const preview = await previewWithPython(
      readFileSync(abs),
      file.originalName,
      mimeFor(file.originalName),
    );
    if (!preview) throw new AppError(502, 'Không đọc được file để xem trước');
    res.json(preview);
  }),
);

/** Toàn bộ ID báo giá khớp bộ lọc hiện tại — dùng cho "Chọn tất cả" khi xóa theo lô
 * (phải đứng trước /:id). Bảng chỉ hiện một trang nhưng thao tác hàng loạt không bị giới hạn theo trang. */
quotesRouter.get(
  '/ids',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const where = q.search ? like(quotes.quoteNo, `%${q.search}%`) : undefined;
    const rows = getDb().select({ id: quotes.id }).from(quotes).where(where).all();
    res.json({ ids: rows.map((r) => r.id) });
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

const batchDeleteSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(5000) });

/**
 * Xóa hàng loạt: báo giá có hóa đơn đã xuất bị BỎ QUA (không chặn cả lô như
 * khi xóa một báo giá), để người dùng chọn "tất cả" vẫn xóa được phần xóa được.
 */
quotesRouter.post(
  '/delete-batch',
  asyncHandler(async (req, res) => {
    const { ids } = batchDeleteSchema.parse(req.body);
    const db = getDb();
    let deleted = 0;
    const skipped: Array<{ id: number; quoteNo: string }> = [];
    for (const id of ids) {
      const quote = db.select().from(quotes).where(eq(quotes.id, id)).get();
      if (!quote) continue;
      const inv = db.select().from(invoices).where(eq(invoices.quoteId, id)).get();
      if (inv?.status === 'exported') {
        skipped.push({ id, quoteNo: quote.quoteNo });
        continue;
      }
      if (inv) {
        db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).run();
        db.delete(invoices).where(eq(invoices.id, inv.id)).run();
      }
      db.delete(quotes).where(eq(quotes.id, id)).run();
      deleted += 1;
    }
    writeAudit(req.user!.id, 'delete', 'quote', ids.join(','), { count: deleted, skipped: skipped.length });
    res.json({ deleted, skipped });
  }),
);

export const __quotesInternals = { and, or };
