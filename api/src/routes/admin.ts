import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, like, or } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { auditLogs, customers, users } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getEnv } from '../env.js';
import { normalizeTaxCode } from '../lib/normalize.js';
import { asyncHandler } from '../middleware/error.js';
import { requireRole } from '../middleware/auth.js';
import { hashPassword } from '../lib/password.js';

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
      .set({ passwordHash: await hashPassword(body.password), updatedAt: new Date().toISOString() })
      .where(eq(users.id, id))
      .run();
    writeAudit(req.user!.id, 'reset_password', 'user', id, {});
    res.json({ ok: true, message: 'Đã đặt lại mật khẩu' });
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

/** Tra cứu MST: kiểm tra trong DB trước; nếu chưa có và cho phép thì gọi service ngoài (stub có timeout). */
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
    const info = await lookupTaxExternal(norm);
    if (!info) {
      res.json({ found: false, inDb: false, message: 'Không tìm thấy thông tin mã số thuế này' });
      return;
    }
    res.json({ found: true, inDb: false, info });
  }),
);

/** Service tra cứu MST ngoài (module tách riêng). Hiện trả null khi không cấu hình —
 *  cắm Tổng cục Thuế / nhà cung cấp ở đây, có timeout 8s. */
async function lookupTaxExternal(
  taxCode: string,
): Promise<{ name: string; address: string } | null> {
  const url = process.env.TAX_LOOKUP_URL;
  if (!url) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${url}?taxCode=${encodeURIComponent(taxCode)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as { name: string; address: string };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const __adminInternals = { like, lookupTaxExternal };
