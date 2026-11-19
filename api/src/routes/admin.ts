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

export interface TaxLookupInfo {
  taxCode: string;
  name: string;
  address: string;
  /** Tên viết tắt / tên quốc tế nếu nhà cung cấp có trả về. */
  shortName?: string;
  internationalName?: string;
  /** Tình trạng hoạt động của người nộp thuế, vd "NNT đang hoạt động". */
  status?: string;
  source: string;
}

/** Cache kết quả 10 phút — tránh gọi lại liên tục khi người dùng bấm nhầm nhiều lần. */
const TAX_CACHE = new Map<string, { at: number; value: Awaited<ReturnType<typeof fetchTaxInfo>> }>();
const TAX_CACHE_TTL = 10 * 60 * 1000;

async function lookupTaxExternal(
  taxCode: string,
): Promise<{ info?: TaxLookupInfo; error?: string }> {
  const cached = TAX_CACHE.get(taxCode);
  if (cached && Date.now() - cached.at < TAX_CACHE_TTL) return cached.value;

  const value = await fetchTaxInfo(taxCode);
  TAX_CACHE.set(taxCode, { at: Date.now(), value });
  return value;
}

/**
 * Tra cứu MST ra ngoài.
 * Mặc định dùng VietQR (`https://api.vietqr.io/v2/business/{MST}`) — không cần key.
 * Đặt `TAX_LOOKUP_URL` nếu muốn thay bằng nhà cung cấp khác; khi đó endpoint được gọi
 * dạng `${TAX_LOOKUP_URL}?taxCode=...` và phải trả `{ name, address }`.
 */
async function fetchTaxInfo(
  taxCode: string,
): Promise<{ info?: TaxLookupInfo; error?: string }> {
  const override = process.env.TAX_LOOKUP_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    if (override) {
      const res = await fetch(`${override}?taxCode=${encodeURIComponent(taxCode)}`, {
        signal: controller.signal,
      });
      if (!res.ok) return { error: 'Dịch vụ tra cứu MST không phản hồi' };
      const body = (await res.json()) as { name?: string; address?: string };
      if (!body.name) return {};
      return {
        info: {
          taxCode,
          name: body.name,
          address: body.address ?? '',
          source: 'custom',
        },
      };
    }

    const res = await fetch(`https://api.vietqr.io/v2/business/${encodeURIComponent(taxCode)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      if (res.status === 429) return { error: 'Tra cứu MST đang bị giới hạn, thử lại sau ít phút' };
      return { error: 'Dịch vụ tra cứu MST không phản hồi' };
    }
    const body = (await res.json()) as {
      code?: string;
      desc?: string;
      data?: {
        id?: string;
        name?: string;
        internationalName?: string | null;
        shortName?: string | null;
        address?: string;
        status?: string;
      } | null;
    };
    // VietQR: code "00" = thành công, "51" = không tìm thấy MST
    if (body.code !== '00' || !body.data?.name) {
      if (body.code === '51') return {};
      return { error: body.desc ?? 'Dịch vụ tra cứu MST trả về lỗi' };
    }
    return {
      info: {
        taxCode,
        name: body.data.name,
        address: body.data.address ?? '',
        shortName: body.data.shortName ?? undefined,
        internationalName: body.data.internationalName ?? undefined,
        status: body.data.status ?? undefined,
        source: 'vietqr',
      },
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { error: 'Tra cứu MST quá thời gian chờ, thử lại sau' };
    }
    return { error: 'Không kết nối được dịch vụ tra cứu MST' };
  } finally {
    clearTimeout(timeout);
  }
}

export const __adminInternals = { like, lookupTaxExternal, fetchTaxInfo, TAX_CACHE };
