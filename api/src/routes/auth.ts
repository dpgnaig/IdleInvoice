import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { writeAudit } from '../lib/audit.js';
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, passwordProblems, verifyPassword } from '../lib/password.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import {
  issueTokens,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../services/tokens.js';

export const REFRESH_COOKIE = 'ii_refresh';
const isProd = () => getEnv().NODE_ENV === 'production';

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

function clientMeta(req: Request) {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

const skipInTest = () => getEnv().NODE_ENV === 'test';

/** Cho phép nới ngưỡng khi chạy e2e/demo bằng biến môi trường; mặc định giữ nguyên. */
const limit = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const authLimiter = rateLimit({
  skip: skipInTest,
  windowMs: 15 * 60 * 1000,
  max: limit('AUTH_RATE_MAX', 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau 15 phút' },
});

const loginLimiter = rateLimit({
  skip: skipInTest,
  windowMs: 15 * 60 * 1000,
  max: limit('LOGIN_RATE_MAX', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút' },
});

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const emailSchema = z.string().trim().toLowerCase().email('Email không hợp lệ');
const passwordSchema = z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự');

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Vui lòng nhập họ tên'),
  email: emailSchema,
  password: passwordSchema,
});

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1) });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const authRouter: Router = Router();

authRouter.use(authLimiter);

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const mode = getEnv().REGISTRATION_MODE;
    if (mode === 'closed') throw forbidden('Hệ thống không mở đăng ký');
    const body = registerSchema.parse(req.body);
    const problems = passwordProblems(body.password);
    if (problems.length) throw badRequest('Mật khẩu chưa đủ mạnh', problems);

    const db = getDb();
    const existing = db.select().from(users).where(eq(users.email, body.email)).get();
    if (existing) throw new AppError(409, 'Email đã được sử dụng');
    const now = new Date().toISOString();
    const status = mode === 'open' ? 'active' : 'pending';
    const created = db
      .insert(users)
      .values({
        email: body.email,
        passwordHash: await hashPassword(body.password),
        fullName: body.fullName,
        role: 'accountant',
        status,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    writeAudit(created.id, 'register', 'user', created.id, { status });
    res.status(201).json({
      status: created.status,
      message:
        status === 'pending'
          ? 'Đăng ký thành công. Tài khoản đang chờ quản trị viên duyệt.'
          : 'Đăng ký thành công, bạn có thể đăng nhập.',
    });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const db = getDb();
    const user = db.select().from(users).where(eq(users.email, body.email)).get();
    const generic = () => unauthorized('Email hoặc mật khẩu không đúng');
    if (!user) throw generic();

    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
      throw new AppError(423, `Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau ${mins} phút`);
    }
    if (user.status === 'pending') throw forbidden('Tài khoản đang chờ quản trị viên duyệt');
    if (user.status === 'locked') throw forbidden('Tài khoản đã bị khóa');

    const ok = await verifyPassword(user.passwordHash, body.password);
    if (!ok) {
      const count = user.failedLoginCount + 1;
      const now = new Date().toISOString();
      db.update(users)
        .set({
          failedLoginCount: count,
          lockedUntil:
            count >= MAX_FAILED
              ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
              : user.lockedUntil,
          updatedAt: now,
        })
        .where(eq(users.id, user.id))
        .run();
      throw generic();
    }

    db.update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
      .where(eq(users.id, user.id))
      .run();

    const authUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    };
    const issued = issueTokens(authUser, clientMeta(req));
    setRefreshCookie(res, issued.refreshToken);
    writeAudit(user.id, 'login', 'user', user.id, {});
    res.json({ accessToken: issued.accessToken, user: authUser });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!presented) throw unauthorized('Không có phiên đăng nhập');
    const issued = rotateRefreshToken(presented, clientMeta(req));
    setRefreshCookie(res, issued.refreshToken);
    res.json({ accessToken: issued.accessToken, user: issued.user });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (presented) revokeRefreshToken(presented);
    clearRefreshCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = getDb().select().from(users).where(eq(users.id, req.user!.id)).get();
    if (!user) throw notFound('Không tìm thấy tài khoản');
    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
    });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = changePasswordSchema.parse(req.body);
    const problems = passwordProblems(body.newPassword);
    if (problems.length) throw badRequest('Mật khẩu mới chưa đủ mạnh', problems);
    const db = getDb();
    const user = db.select().from(users).where(eq(users.id, req.user!.id)).get();
    if (!user) throw notFound('Không tìm thấy tài khoản');
    const ok = await verifyPassword(user.passwordHash, body.currentPassword);
    if (!ok) throw badRequest('Mật khẩu hiện tại không đúng');
    db.update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date().toISOString() })
      .where(eq(users.id, user.id))
      .run();
    revokeAllForUser(user.id);
    clearRefreshCookie(res);
    writeAudit(user.id, 'change_password', 'user', user.id, {});
    res.json({ ok: true, message: 'Đã đổi mật khẩu, vui lòng đăng nhập lại' });
  }),
);

export const __authInternals = { MAX_FAILED, LOCK_MINUTES, and };
