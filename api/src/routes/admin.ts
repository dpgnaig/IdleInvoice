import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, like, or } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { auditLogs, customers, invoices, quoteFiles, refreshTokens, users } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getEnv } from '../env.js';
import { normalizeTaxCode } from '../lib/normalize.js';
import { asyncHandler } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { hashPassword } from '../lib/password.js';
import {
  lookupTaxExternal,
  fetchTaxInfo,
  TAX_CACHE,
  type TaxLookupInfo,
} from '../services/tax-lookup.js';

export type { TaxLookupInfo };

export const adminRouter: Router = Router();
adminRouter.use(requireRole('admin'));

const usersQuery = z.object({
  search: z.string().trim().optional().default(''),
  role: z.enum(['admin', 'accountant']).optional(),
  status: z.enum(['pending', 'active', 'locked']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const q = usersQuery.parse(req.query);
    const db = getDb();
    const conds = [];
    if (q.search) {
      conds.push(or(like(users.email, `%${q.search}%`), like(users.fullName, `%${q.search}%`)));
    }
    if (q.role) conds.push(eq(users.role, q.role));
    if (q.status) conds.push(eq(users.status, q.status));
    const where = conds.length ? and(...conds) : undefined;
    const rows = db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        lockedUntil: users.lockedUntil,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
    const total = db.select({ n: count() }).from(users).where(where).get()?.n ?? 0;
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

const patchUserSchema = z.object({
  status: z.enum(['pending', 'active', 'locked']).optional(),
  role: z.enum(['admin', 'accountant']).optional(),
});

adminRouter.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = patchUserSchema.parse(req.body);
    if (id === req.user!.id && (body.status === 'locked' || body.role === 'accountant')) {
      throw badRequest('Không thể tự khóa hoặc tự hạ quyền tài khoản của mình');
    }
    const db = getDb();
    const user = db.select().from(users).where(eq(users.id, id)).get();
    if (!user) throw notFound('Không tìm thấy người dùng');
    db.update(users)
      .set({ ...body, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id))
      .run();
    writeAudit(req.user!.id, 'update', 'user', id, body);
    res.json({ ok: true });
  }),
);

const resetSchema = z.object({ password: z.string().min(8, 'Mật khẩu mới phải có ít nhất 8 ký tự') });

adminRouter.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = resetSchema.parse(req.body);
    const db = getDb();
    const user = db.select().from(users).where(eq(users.id, id)).get();
    if (!user) throw notFound('Không tìm thấy người dùng');
    db.update(users)
      .set({
        passwordHash: await hashPassword(body.password),
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, id))
      .run();
    // Đăng xuất mọi phiên cũ của user này
    db.delete(refreshTokens).where(eq(refreshTokens.userId, id)).run();
    writeAudit(req.user!.id, 'reset_password', 'user', id, {});
    res.json({ ok: true, message: 'Đã đặt lại mật khẩu' });
  }),
);

adminRouter.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest('ID người dùng không hợp lệ');
    if (id === req.user!.id) throw badRequest('Không thể tự xóa tài khoản của mình');
    const db = getDb();
    const user = db.select().from(users).where(eq(users.id, id)).get();
    if (!user) throw notFound('Không tìm thấy người dùng');
    // Giữ lại dữ liệu nghiệp vụ/nhật ký, chỉ bỏ liên kết tới user bị xóa (refresh_tokens tự cascade)
    db.transaction((tx) => {
      tx.update(quoteFiles).set({ uploadedBy: null }).where(eq(quoteFiles.uploadedBy, id)).run();
      tx.update(invoices).set({ createdBy: null }).where(eq(invoices.createdBy, id)).run();
      tx.update(auditLogs).set({ userId: null }).where(eq(auditLogs.userId, id)).run();
      tx.delete(users).where(eq(users.id, id)).run();
    });
    writeAudit(req.user!.id, 'delete', 'user', id, { email: user.email });
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const db = getDb();
    const rows = db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .all();
    const total = db.select({ n: count() }).from(auditLogs).get()?.n ?? 0;
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

export const customersAdminExtras = Router();

/** Tra cứu MST: kiểm tra trong DB trước; nếu chưa có và cho phép thì tra cứu ngoài. */
customersAdminExtras.post(
  '/customers/lookup-tax',
  asyncHandler(async (req, res) => {
    const { taxCode } = z.object({ taxCode: z.string().min(1) }).parse(req.body);
    const norm = normalizeTaxCode(taxCode);
    const db = getDb();
    const existing = db.select().from(customers).where(eq(customers.taxCode, norm)).get();
    if (existing) {
      res.json({ found: true, inDb: true, customer: existing });
      return;
    }
    if (getEnv().TAX_LOOKUP_ENABLED === 'false') {
      res.json({ found: false, inDb: false, message: 'Chức năng tra cứu MST đang tắt' });
      return;
    }
    const result = await lookupTaxExternal(norm);
    if (result.error) {
      res.json({ found: false, inDb: false, message: result.error });
      return;
    }
    if (!result.info) {
      res.json({ found: false, inDb: false, message: 'Không tìm thấy thông tin mã số thuế này' });
      return;
    }
    res.json({ found: true, inDb: false, info: result.info });
  }),
);

export const __adminInternals = { like, lookupTaxExternal, fetchTaxInfo, TAX_CACHE };
